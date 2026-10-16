// Plan (tariff) management.

import { Hono } from "hono";
import { audit } from "../db/index.js";
import { validate } from "../lib/validate.js";
import { clientIp, ok, readJson, requireAdmin, safe, type AppVariables } from "../middleware.js";
import { createPlan, deletePlan, getPlan, listPlans, updatePlan } from "../services/store.js";

export const planRoutes = new Hono<{ Variables: AppVariables }>();

planRoutes.get(
  "/",
  safe(async (c) => {
    return ok(c, { plans: await listPlans(false) });
  })
);

planRoutes.post(
  "/",
  requireAdmin,
  safe(async (c) => {
    const body = await readJson(c);
    const input = validate<{ name: string; price: number; days: number; data_gb: number; device_limit: number; speed_mbps: number }>(body, (v) => {
      v.string("name", { required: true, max: 64, label: "نام پلن" });
      v.number("price", { def: 0, min: 0, max: 1_000_000_000, label: "قیمت" });
      v.int("days", { def: 30, min: 0, max: 3650, label: "مدت (روز)" });
      v.number("data_gb", { def: 0, min: 0, max: 1_000_000, label: "حجم (گیگ)" });
      v.int("device_limit", { def: 1, min: 0, max: 1000, label: "تعداد دستگاه" });
      v.int("speed_mbps", { def: 0, min: 0, max: 10_000, label: "محدودیت سرعت" });
    });
    const plan = await createPlan({
      name: input.name,
      price: input.price,
      reseller_price: Number(body.reseller_price ?? 0),
      days: input.days,
      data_gb: input.data_gb,
      device_limit: input.device_limit,
      speed_mbps: input.speed_mbps,
      protocol: body.protocol ? String(body.protocol) : null,
      node_ids: Array.isArray(body.node_ids) ? JSON.stringify(body.node_ids.map(Number)) : null,
      icon: body.icon ? String(body.icon) : null,
      description: body.description ? String(body.description) : null,
      sort: Number(body.sort ?? 0),
      visible: body.visible === false ? 0 : 1,
    });
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "plan_create", target: plan.name, ip: clientIp(c) });
    return ok(c, { plan }, 201);
  })
);

planRoutes.put(
  "/:id",
  requireAdmin,
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const plan = await getPlan(id);
    if (!plan) return c.json({ error: "پلن پیدا نشد", code: "not_found" }, 404);
    const body = await readJson(c);
    const patch: Record<string, unknown> = {};
    for (const key of ["name", "price", "reseller_price", "days", "data_gb", "device_limit", "speed_mbps", "protocol", "icon", "description", "sort"]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.node_ids !== undefined) patch.node_ids = Array.isArray(body.node_ids) ? JSON.stringify(body.node_ids.map(Number)) : null;
    if (body.visible !== undefined) patch.visible = body.visible ? 1 : 0;
    await updatePlan(id, patch);
    return ok(c, { plan: await getPlan(id) });
  })
);

planRoutes.delete(
  "/:id",
  requireAdmin,
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const plan = await getPlan(id);
    if (!plan) return c.json({ error: "پلن پیدا نشد", code: "not_found" }, 404);
    await deletePlan(id);
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "plan_delete", target: plan.name, ip: clientIp(c) });
    return ok(c, { message: "پلن حذف شد" });
  })
);
