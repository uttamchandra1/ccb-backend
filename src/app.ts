import express from "express";
import cookieParser from "cookie-parser";
import authRouter from "./routes/auth.routes";
import gmailRouter from "./routes/gmail.routes";
import cardsRouter from "./routes/cards.routes";
import inviteRouter from "./routes/invite.routes";

const app = express();

// Global middleware
app.use(express.json());
app.use(cookieParser());

// Health check
app.get("/api", (_req, res) => {
  res.json({ message: "Hello from API" });
});

// Mount routers at root and /api to preserve existing endpoints
app.use("/", authRouter);
app.use("/", gmailRouter);
app.use("/", cardsRouter);
app.use("/", inviteRouter);
app.use("/api", authRouter);
app.use("/api", gmailRouter);
app.use("/api", cardsRouter);
app.use("/api", inviteRouter);

export default app;
