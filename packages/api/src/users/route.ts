import { Router } from "express";
import { UsersController } from "./controller.js";
import type { Express } from "express";
import type { ApiDb } from "../db.js";

export function setupUsersRoutes(app: Express, db: ApiDb): void {
  const router = Router();
  const controller = new UsersController(db);

  // User routes
  router.post("/users", async (req: any, res: any) => {
    await controller.create(req, res);
  });

  router.post("/users/:userId/devices", async (req: any, res: any) => {
    await controller.registerDevice(req, res);
  });

  app.use("/api", router);
}
