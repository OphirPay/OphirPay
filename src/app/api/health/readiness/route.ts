// SPDX-License-Identifier: MIT
import { GET as healthGet } from "../route";

/**
 * Dedicated readiness probe endpoint.
 * Evaluates database, redis, stellar RPC & Horizon reachability.
 */
export const GET = healthGet;
