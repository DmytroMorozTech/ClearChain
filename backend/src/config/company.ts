/**
 * The company whose supply chain this instance tracks.
 *
 * Lindenwear is deliberately NOT a Supplier row. Seeding it as one would put the buyer
 * into every supplier count, drag it through the compliance percentage and give it a
 * slice of the risk distribution chart — a company that is not a supplier quietly
 * corrupting every aggregate on the dashboard. It exists only as the synthetic root of
 * the chain graph.
 */
export const COMPANY_NAME = 'Lindenwear GmbH';

/** Stable id for the synthetic root node. Never collides with a supplier UUID. */
export const COMPANY_NODE_ID = 'company-root';
