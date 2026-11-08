import { Router } from "express";
import { UsersController } from "./controller.js";
import type { Express } from "express";

export function setupUsersRoutes(app: Express): void {
  const router = Router();

  // User routes
  router.post("/users", async (req: any, res: any) => {
    await UsersController.create(req, res);
  });

  router.post("/users/:userId/devices", async (req: any, res: any) => {
    await UsersController.registerDevice(req, res);
  });

  app.use("/api", router);
}