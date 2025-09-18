"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const gmail_controller_1 = require("../controllers/gmail.controller");
const router = (0, express_1.Router)();
router.get("/gmail/cards", gmail_controller_1.getGmailCards);
router.post("/contacts/sync", gmail_controller_1.syncContacts);
router.get("/contacts", gmail_controller_1.getContacts);
router.get("/test/database", gmail_controller_1.testDatabase);
exports.default = router;
//# sourceMappingURL=gmail.routes.js.map