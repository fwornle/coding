// Shared model-list helpers for the Performance surfaces.

// Unify a model id's version separator so the same model written two ways collapses
// to one canonical name: the version pair `<major>-<minor>` is rewritten to
// `<major>.<minor>` (e.g. `claude-sonnet-4-6` → `claude-sonnet-4.6`,
// `claude-opus-4-8` → `claude-opus-4.8`). Family hyphens are preserved; a model
// that already uses the dot form is returned unchanged. Applied at every display
// and facet-derivation site so `claude-sonnet-4-6` and `claude-sonnet-4.6` are
// never counted, listed, or filtered as two distinct models.
export function normalizeModel(model: string | null | undefined): string | null | undefined {
  if (model == null) return model
  return model.replace(/(\d)-(\d)/g, '$1.$2')
}

// Collapse a background_models list to the DISTINCT (normalized) model names,
// preserving first-seen order. The persisted list carries one entry per background
// process, so the same model repeats (e.g. 5× claude-sonnet-4.6) and may appear in
// both hyphen and dot spellings; readers want the SET of models that ran. Used by
// both the runs-table "Background models" column and the timeline header.
export function distinctModels(list: { model: string }[] | null | undefined): string[] {
  if (!list?.length) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of list) {
    const model = normalizeModel(entry.model)
    if (model && !seen.has(model)) {
      seen.add(model)
      out.push(model)
    }
  }
  return out
}
