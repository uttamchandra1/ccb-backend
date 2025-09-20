import { Request, Response } from "express";
import { google } from "googleapis";
import supabase, { supabaseAdmin } from "../app/supabase";

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI!;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function getUserFromToken(req: Request) {
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;
  const cookieToken = req.cookies?.["sb-access-token"] as string | undefined;
  const supabaseAccessToken = bearerToken || cookieToken;

  if (!supabaseAccessToken) {
    throw new Error("Missing Supabase access token");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(
    supabaseAccessToken
  );
  if (userError || !userData.user) {
    throw new Error(userError?.message || "Invalid Supabase token");
  }

  return userData.user;
}

async function getGoogleTokens(userId: string) {
  if (!supabaseAdmin) {
    throw new Error("Server not configured with SUPABASE_SERVICE_ROLE_KEY");
  }

  const { data: tokenRow, error: tokenError } = await supabaseAdmin
    .from("user_google_tokens")
    .select("access_token, refresh_token, expiry_date")
    .eq("user_id", userId)
    .single();

  if (tokenError || !tokenRow) {
    throw new Error("No Google tokens found for user");
  }

  // Check if token is expired and refresh if needed
  const now = Date.now();
  const expiryDate = tokenRow.expiry_date
    ? parseInt(tokenRow.expiry_date.toString())
    : 0;

  if (expiryDate < now + 60000) {
    // Refresh if expires within 1 minute
    console.log("Access token expired, refreshing...");
    return await refreshGoogleToken(userId, tokenRow.refresh_token);
  }

  return tokenRow;
}

async function refreshGoogleToken(userId: string, refreshToken: string) {
  if (!supabaseAdmin) {
    throw new Error("Server not configured with SUPABASE_SERVICE_ROLE_KEY");
  }

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();

    // Update the tokens in database
    const { error: updateError } = await supabaseAdmin
      .from("user_google_tokens")
      .update({
        access_token: credentials.access_token,
        expiry_date: credentials.expiry_date,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateError) {
      console.error("Failed to update refreshed token:", updateError);
      throw new Error("Failed to update refreshed token");
    }

    return {
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token || refreshToken,
      expiry_date: credentials.expiry_date,
    };
  } catch (error) {
    console.error("Token refresh failed:", error);
    throw new Error(
      "Failed to refresh access token. User needs to re-authenticate."
    );
  }
}

function parseEmailHeaders(headers: any[]) {
  const getHeader = (name: string) =>
    headers.find((h) => (h.name || "").toLowerCase() === name.toLowerCase())
      ?.value;

  return {
    subject: getHeader("subject"),
    from: getHeader("from"),
    to: getHeader("to"),
    cc: getHeader("cc"),
    bcc: getHeader("bcc"),
    date: getHeader("date"),
  };
}

function parseEmailAddress(emailString: string) {
  if (!emailString) return { email: "", name: "" };

  const match =
    emailString.match(/^(.+?)\s*<(.+)>$/) || emailString.match(/^(.+)$/);
  if (match && match[2]) {
    return { name: match[1].trim().replace(/"/g, ""), email: match[2].trim() };
  }
  return { email: emailString.trim(), name: "" };
}

function parseEmailAddresses(emailString: string): string[] {
  if (!emailString) return [];
  return emailString
    .split(",")
    .map((e) => parseEmailAddress(e.trim()).email)
    .filter(Boolean);
}

export async function syncEmails(req: Request, res: Response) {
  try {
    const user = await getUserFromToken(req);
    const userId = user.id;
    const tokenRow = await getGoogleTokens(userId);

    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({
      access_token: tokenRow.access_token || undefined,
      refresh_token: tokenRow.refresh_token || undefined,
      expiry_date: tokenRow.expiry_date || undefined,
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Get query parameters for pagination and filtering
    const maxResults = parseInt(req.query.maxResults as string) || 50;
    const pageToken = req.query.pageToken as string;
    const query = (req.query.q as string) || "newer_than:30d";

    let listResp;
    try {
      listResp = await gmail.users.messages.list({
        userId: "me",
        maxResults,
        pageToken,
        q: query,
      });
    } catch (error: any) {
      if (error.code === 401) {
        console.error("Gmail API authentication failed:", error.message);
        return res.status(401).json({
          error:
            "Gmail authentication expired. Please re-authenticate with Google.",
          code: "GMAIL_AUTH_EXPIRED",
        });
      }
      throw error;
    }

    const messageIds = (listResp.data.messages || [])
      .map((m) => m.id!)
      .filter(Boolean);

    let syncedCount = 0;
    let skippedCount = 0;

    for (const messageId of messageIds) {
      // Check if email already exists
      const { data: existingEmail } = await supabaseAdmin!
        .from("emails")
        .select("id")
        .eq("user_id", userId)
        .eq("gmail_message_id", messageId)
        .single();

      if (existingEmail) {
        skippedCount++;
        continue;
      }

      // Fetch full message
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      const headers = msg.data.payload?.headers || [];
      const emailHeaders = parseEmailHeaders(headers);
      const senderInfo = parseEmailAddress(emailHeaders.from || "");

      // Extract body
      let bodyText = "";
      let bodyHtml = "";

      function extractBody(part: any) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          bodyText = Buffer.from(part.body.data, "base64").toString("utf-8");
        } else if (part.mimeType === "text/html" && part.body?.data) {
          bodyHtml = Buffer.from(part.body.data, "base64").toString("utf-8");
        } else if (part.parts) {
          part.parts.forEach(extractBody);
        }
      }

      if (msg.data.payload) {
        extractBody(msg.data.payload);
      }

      // Insert email into database
      const emailData = {
        user_id: userId,
        gmail_message_id: messageId,
        thread_id: msg.data.threadId,
        subject: emailHeaders.subject,
        sender_email: senderInfo.email,
        sender_name: senderInfo.name,
        recipient_emails: parseEmailAddresses(emailHeaders.to || ""),
        cc_emails: parseEmailAddresses(emailHeaders.cc || ""),
        bcc_emails: parseEmailAddresses(emailHeaders.bcc || ""),
        body_text: bodyText,
        body_html: bodyHtml,
        snippet: msg.data.snippet,
        labels: msg.data.labelIds || [],
        date_received: emailHeaders.date
          ? new Date(emailHeaders.date).toISOString()
          : new Date().toISOString(),
        date_sent: emailHeaders.date
          ? new Date(emailHeaders.date).toISOString()
          : new Date().toISOString(),
        is_read: !msg.data.labelIds?.includes("UNREAD"),
        is_important: msg.data.labelIds?.includes("IMPORTANT") || false,
        has_attachments:
          msg.data.payload?.parts?.some((part) => part.filename) || false,
        size_estimate: msg.data.sizeEstimate || 0,
      };

      const { error: emailInsertError } = await supabaseAdmin!
        .from("emails")
        .insert(emailData);

      if (emailInsertError) {
        console.error("Email insert error:", emailInsertError);
      } else {
        syncedCount++;
      }
    }

    res.json({
      success: true,
      synced: syncedCount,
      skipped: skippedCount,
      total: messageIds.length,
      nextPageToken: listResp.data.nextPageToken,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to sync emails" });
  }
}

export async function getEmails(req: Request, res: Response) {
  try {
    const user = await getUserFromToken(req);
    const userId = user.id;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin!
      .from("emails")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("date_received", { ascending: false });

    if (search) {
      query = query.or(
        `subject.ilike.%${search}%,sender_email.ilike.%${search}%,sender_name.ilike.%${search}%`
      );
    }

    const {
      data: emails,
      error,
      count,
    } = await query.range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      emails: emails || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to get emails" });
  }
}

export async function syncContacts(req: Request, res: Response) {
  try {
    const user = await getUserFromToken(req);
    const userId = user.id;
    const tokenRow = await getGoogleTokens(userId);

    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({
      access_token: tokenRow.access_token || undefined,
      refresh_token: tokenRow.refresh_token || undefined,
      expiry_date: tokenRow.expiry_date || undefined,
    });

    const people = google.people({ version: "v1", auth: oauth2Client });

    const pageSize = parseInt(req.query.pageSize as string) || 100;
    const pageToken = req.query.pageToken as string;

    const response = await people.people.connections.list({
      resourceName: "people/me",
      pageSize,
      pageToken,
      personFields:
        "names,emailAddresses,phoneNumbers,addresses,organizations,photos,birthdays,biographies,metadata",
    });

    const connections = response.data.connections || [];
    let syncedCount = 0;
    let skippedCount = 0;

    for (const contact of connections) {
      const googleContactId =
        contact.resourceName?.replace("people/", "") || "";

      if (!googleContactId) continue;

      // Check if contact already exists
      const { data: existingContact } = await supabaseAdmin!
        .from("contacts")
        .select("id")
        .eq("user_id", userId)
        .eq("google_contact_id", googleContactId)
        .single();

      const contactData = {
        user_id: userId,
        google_contact_id: googleContactId,
        display_name: contact.names?.[0]?.displayName,
        given_name: contact.names?.[0]?.givenName,
        family_name: contact.names?.[0]?.familyName,
        middle_name: contact.names?.[0]?.middleName,
        nickname: contact.nicknames?.[0]?.value,
        email_addresses: contact.emailAddresses || [],
        phone_numbers: contact.phoneNumbers || [],
        addresses: contact.addresses || [],
        organizations: contact.organizations || [],
        photo_url: contact.photos?.[0]?.url,
      };

      if (existingContact) {
        const { error: updateError } = await supabaseAdmin!
          .from("contacts")
          .update(contactData)
          .eq("id", existingContact.id);

        if (updateError) {
          console.error("Contact update error:", updateError);
        }
      } else {
        const { error: insertError } = await supabaseAdmin!
          .from("contacts")
          .insert(contactData);

        if (insertError) {
          console.error("Contact insert error:", insertError);
        } else {
          syncedCount++;
        }
      }
    }

    res.json({
      success: true,
      synced: syncedCount,
      skipped: skippedCount,
      total: connections.length,
      nextPageToken: response.data.nextPageToken,
    });
  } catch (error: any) {
    res
      .status(500)
      .json({ error: error?.message || "Failed to sync contacts" });
  }
}

export async function testDatabase(req: Request, res: Response) {
  try {
    const user = await getUserFromToken(req);
    const userId = user.id;

    if (!supabaseAdmin) {
      return res.status(500).json({ error: "Supabase admin not configured" });
    }

    // Test if tables exist and are accessible
    const emailsTest = await supabaseAdmin
      .from("emails")
      .select("count(*)", { count: "exact" })
      .eq("user_id", userId);

    const contactsTest = await supabaseAdmin
      .from("contacts")
      .select("count(*)", { count: "exact" })
      .eq("user_id", userId);

    res.json({
      tablesAccessible: true,
      emailsCount: emailsTest.count || 0,
      contactsCount: contactsTest.count || 0,
      emailsError: emailsTest.error?.message,
      contactsError: contactsTest.error?.message,
      userId: userId,
    });
  } catch (error: any) {
    res.status(500).json({
      error: error?.message || "Database test failed",
      tablesAccessible: false,
    });
  }
}

export async function getContacts(req: Request, res: Response) {
  try {
    const user = await getUserFromToken(req);
    const userId = user.id;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin!
      .from("contacts")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("display_name", { ascending: true });

    if (search) {
      query = query.or(
        `display_name.ilike.%${search}%,given_name.ilike.%${search}%,family_name.ilike.%${search}%`
      );
    }

    const {
      data: contacts,
      error,
      count,
    } = await query.range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      contacts: contacts || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to get contacts" });
  }
}

export async function getGmailCards(req: Request, res: Response) {
  try {
    const user = await getUserFromToken(req);
    const userId = user.id;
    const tokenRow = await getGoogleTokens(userId);

    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({
      access_token: tokenRow.access_token || undefined,
      refresh_token: tokenRow.refresh_token || undefined,
      expiry_date: tokenRow.expiry_date || undefined,
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    let listResp;
    try {
      listResp = await gmail.users.messages.list({
        userId: "me",
        maxResults: 25,
        q: "category:primary newer_than:365d",
      });
    } catch (error: any) {
      if (error.code === 401) {
        console.error("Gmail API authentication failed:", error.message);
        return res.status(401).json({
          error:
            "Gmail authentication expired. Please re-authenticate with Google.",
          code: "GMAIL_AUTH_EXPIRED",
        });
      }
      throw error;
    }

    const messageIds = (listResp.data.messages || [])
      .map((m) => m.id!)
      .filter(Boolean);
    const results: Array<{
      id: string;
      subject?: string;
      from?: string;
      matchedCards: string[];
    }> = [];

    const cardMatchers: Array<{ name: string; pattern: RegExp }> = [
      { name: "Visa", pattern: /\bvisa\b/i },
      { name: "Mastercard", pattern: /\bmaster\s?card\b/i },
      { name: "American Express", pattern: /\bamerican\s*express\b|\bamex\b/i },
      { name: "Discover", pattern: /\bdiscover\b/i },
      { name: "RuPay", pattern: /\brupay\b/i },
      { name: "HDFC", pattern: /\bhdfc\b/i },
      { name: "ICICI", pattern: /\bicici\b/i },
      { name: "SBI", pattern: /\bsbi\b/i },
      { name: "Axis", pattern: /\baxis\b/i },
      { name: "Kotak", pattern: /\bkotak\b/i },
      { name: "Citi", pattern: /\bciti\b|\bcitibank\b/i },
      { name: "Barclays", pattern: /\bbarclays\b/i },
      { name: "Capital One", pattern: /\bcapital\s*one\b/i },
      { name: "Chase", pattern: /\bchase\b/i },
    ];

    for (const id of messageIds) {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["subject", "from"],
      });
      const headers = msg.data.payload?.headers || [];
      const subject = (headers.find(
        (h) => (h.name || "").toLowerCase() === "subject"
      )?.value ?? undefined) as string | undefined;
      const from = (headers.find((h) => (h.name || "").toLowerCase() === "from")
        ?.value ?? undefined) as string | undefined;
      const textForMatch = `${subject || ""} ${from || ""}`;
      const matchedCards = cardMatchers
        .filter((c) => c.pattern.test(textForMatch))
        .map((c) => c.name);
      results.push({ id, subject, from, matchedCards });
    }

    const distinctCards = Array.from(
      new Set(results.flatMap((r) => r.matchedCards))
    ).sort();

    res.json({ userId, cards: distinctCards, samples: results.slice(0, 10) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to read Gmail" });
  }
}
