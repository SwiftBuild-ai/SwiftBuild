export function recordCatalogUse(id: string) {
  try {
    const previous = JSON.parse(
      localStorage.getItem('swiftbuild.catalog.preferences') ?? '{}',
    );
    const recent = Array.isArray(previous.recent)
      ? previous.recent.filter(
          (v: unknown) => typeof v === 'string' && v !== id,
        )
      : [];
    localStorage.setItem(
      'swiftbuild.catalog.preferences',
      JSON.stringify({
        favorites: Array.isArray(previous.favorites) ? previous.favorites : [],
        recent: [id, ...recent].slice(0, 12),
      }),
    );
  } catch {
    /* Preferences are optional; architecture persistence is independent. */
  }
  window.dispatchEvent(
    new CustomEvent('swiftbuild:component-added', { detail: id }),
  );
}
