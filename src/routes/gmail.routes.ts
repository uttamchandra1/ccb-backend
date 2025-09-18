import { Router } from "express";
import {
  getGmailCards,
  syncContacts,
  getContacts,
  testDatabase,
} from "../controllers/gmail.controller";

const router = Router();

router.get("/gmail/cards", getGmailCards);
router.post("/contacts/sync", syncContacts);
router.get("/contacts", getContacts);
router.get("/test/database", testDatabase);

export default router;
