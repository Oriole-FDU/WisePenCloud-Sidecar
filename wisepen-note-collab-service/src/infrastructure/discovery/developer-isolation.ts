export const DEVELOPER_METADATA_KEY = 'developer';

interface DeveloperRoutableInstance {
  metadata?: Record<string, string>;
}

export function selectDeveloperInstances<T extends DeveloperRoutableInstance>(
  instances: T[],
  developer: string | undefined,
): T[] {
  const baseline = instances.filter(
    (instance) =>
      !Object.prototype.hasOwnProperty.call(instance.metadata ?? {}, DEVELOPER_METADATA_KEY),
  );
  if (!developer) return baseline;
  const matched = instances.filter(
    (instance) => instance.metadata?.[DEVELOPER_METADATA_KEY] === developer,
  );
  return matched.length > 0 ? matched : baseline;
}
