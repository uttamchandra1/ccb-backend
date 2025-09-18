"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseAdmin = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const supabaseUrl = process.env.SUPABASE_API_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
exports.supabaseAdmin = supabaseServiceRoleKey
    ? (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceRoleKey)
    : undefined;
exports.default = supabase;
//# sourceMappingURL=supabase.js.map