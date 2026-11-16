import type { ActivityQuery } from "./control-store.js";
// Only fixed server-owned JSON fields become SQL; every caller value is a parameter.
export function activityWhere(
  query: ActivityQuery,
  dialect: "sqlite" | "postgres",
) {
  const values: string[] = [],
    clauses: string[] = [];
  const field = (name: string) =>
    dialect === "sqlite"
      ? `json_extract(data,'$.${name}')`
      : `data::jsonb->>'${name}'`;
  const bind = (value: string) => {
    values.push(value);
    return dialect === "sqlite" ? "?" : "$" + values.length;
  };
  for (const key of [
    "agentId",
    "grantId",
    "tool",
    "status",
    "resource",
  ] as const)
    if (query[key]) clauses.push(`${field(key)}=${bind(query[key]!)}`);
  if (query.from) clauses.push(`${field("createdAt")}>=${bind(query.from)}`);
  if (query.to) clauses.push(`${field("createdAt")}<=${bind(query.to)}`);
  return {
    where: clauses.length ? " WHERE " + clauses.join(" AND ") : "",
    values,
  };
}
