export function lockedVersions(lockText: string): Map<string, Set<string>>;
export function lockOverrides(lockText: string, direct: string[]): Record<string, string>;
