/**
 * Re-export shim. The implementation moved to the @momishop/shared workspace
 * package so the backend and frontend share a single copy. This keeps existing
 * `@/lib/rbac` imports compiling until the app moves into frontend/.
 */
export * from '@momishop/shared/rbac';
