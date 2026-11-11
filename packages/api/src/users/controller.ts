import { Request, Response } from "express";
import { createUser, registerDevice } from "./service.js";
import type { ApiDb } from "../db.js";

/** Controller handling user-related HTTP requests. */
export class UsersController {
  constructor(private readonly db: ApiDb) {}

  /** POST /users - Create a user with an API key */
  async create(req: Request, res: Response): Promise<void> {
    const { apiKey } = req.body;
    if (!apiKey) {
      res.status(400).json({ error: "apiKey required" });
      return;
    }
    const result = await createUser(this.db, apiKey);
    res.status(201).json(result);
  }

  /** POST /users/:userId/devices - Register a push device for a user */
  async registerDevice(req: Request, res: Response): Promise<void> {
    const { userId } = req.params;
    if (!userId) {
      res.status(400).json({ error: "userId required" });
      return;
    }
    const { pushToken } = req.body;
    if (!pushToken) {
      res.status(400).json({ error: "pushToken required" });
      return;
    }
    const deviceId = await registerDevice(this.db, userId as string, pushToken);
    res.status(201).json({ deviceId });
  }
}
