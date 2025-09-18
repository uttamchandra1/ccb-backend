"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const gmail_routes_1 = __importDefault(require("./routes/gmail.routes"));
const cards_routes_1 = __importDefault(require("./routes/cards.routes"));
const app = (0, express_1.default)();
// Global middleware
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
// Health check
app.get("/api", (_req, res) => {
    res.json({ message: "Hello from API" });
});
// Mount routers at root and /api to preserve existing endpoints
app.use("/", auth_routes_1.default);
app.use("/", gmail_routes_1.default);
app.use("/", cards_routes_1.default);
app.use("/api", auth_routes_1.default);
app.use("/api", gmail_routes_1.default);
app.use("/api", cards_routes_1.default);
exports.default = app;
//# sourceMappingURL=app.js.map