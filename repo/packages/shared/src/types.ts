/**
 * Standard API response envelope.
 * All API endpoints return responses conforming to this shape.
 */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    request_id?: string;
    version: string;
  };
}

/**
 * Paginated list wrapper used in collection endpoints.
 */
export interface PaginatedList<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Standard pagination query parameters.
 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

/**
 * Audit log entry shape (read-only, returned from API).
 */
export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  legal_hold: boolean;
  created_at: string;
}
