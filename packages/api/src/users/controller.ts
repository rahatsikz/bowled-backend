import { Request, Response } from "express";
import { createUser, registerDevice } from "./service.js";
import type { DeliveryRecord, DeliveryStatus, Report } from "@bowled/shared";

/** Controller handling user-related HTTP requests. */
export class UsersController {
  /** POST /users - Create a user with an API key */
  static async create(req: Request, res: Response): Promise<void> {
    const { apiKey } = req.body;
    if (!apiKey) {
      res.status(400).json({ error: "apiKey required" });
      return;
    }
    const result = await createUser(apiKey);
    res.status(201).json(result);
  }

  /** POST /devices - Register a push device for a user */
  static async registerDevice(req: Request, res: Response): Promise<void> {
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
    const deviceId = await registerDevice(userId as string, pushToken);
    res.status(201).json({ deviceId });
  }
}