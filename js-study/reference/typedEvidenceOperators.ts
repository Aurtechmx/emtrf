/**
 * Tool-independent EMTRF typed-evidence reference implementation.
 * Scientific support values with different meanings are NEVER numerically
 * collapsed into one evidence value. Each semantic channel is conserved
 * independently by a channel-wise minimum.
 *
 * An evidence record is e = (p, S, A, l): provenance, typed support, applicability
 * (which channels are in scientific scope for that source, and over what scope), and
 * lineage. Applicability is what separates the two cases a support map alone cannot
 * distinguish: a channel that is NOT APPLICABLE to a source is correctly ignored by the
 * meet, whereas a channel that IS APPLICABLE to a required source but has NO VALUE makes
 * the output channel unavailable. The output must never be computed from the remaining
 * sources alone.
 *
 * Backward compatibility: when a record declares no applicability, applicability is
 * inferred from the channels actually carried (present == applicable). Records written
 * against the earlier support-only shape therefore behave exactly as before.
 */
export type Provenance = 'measured' | 'interpolated';
export type SupportMeaning =
  | 'raw-measured-support'
  | 'empirical-measured-reliability'
  | 'geometric-interpolation-support'
  | 'model-support';

export type SupportChannels = Readonly<Partial<Record<SupportMeaning, number>>>;

/** Applicability of one channel to one source: in scientific scope, and over which scope terms. */
export interface ChannelApplicability {
  readonly applicable: boolean;
  /** Optional scope terms. Omitted means "unrestricted"; the meet intersects declared scopes. */
  readonly scope?: readonly string[];
}
export type ApplicabilityMap = Readonly<Partial<Record<SupportMeaning, ChannelApplicability>>>;

export interface TypedEvidence {
  readonly provenance: readonly Provenance[];
  readonly support: SupportChannels;
  /** A_i. Omitted => inferred from the carried support channels. */
  readonly applicability?: ApplicabilityMap;
  /** l_i. Complete source lineage; unioned by the meet. */
  readonly lineage?: readonly string[];
  /**
   * Channels that are applicable to a required source but cannot be reported, either
   * because an applicable source carried no value or because the scope intersection is
   * empty. An unavailable channel is NOT the same as an absent channel.
   */
  readonly unavailable?: readonly SupportMeaning[];
  /** Scope actually carried per reported channel (intersection over applicable sources). */
  readonly scope?: Readonly<Partial<Record<SupportMeaning, readonly string[]>>>;
}

export type TypedCellEvidence =
  | (TypedEvidence & { readonly state: 'measured' | 'interpolated' | 'mixed' })
  | { readonly state: 'unsupported'; readonly provenance: readonly []; readonly support: Readonly<{}> };

const PROV_ORDER: readonly Provenance[] = ['measured', 'interpolated'];
const SUPPORT_ORDER: readonly SupportMeaning[] = [
  'raw-measured-support',
  'empirical-measured-reliability',
  'geometric-interpolation-support',
  'model-support',
];

function normalizeProvenance(xs: readonly Provenance[]): Provenance[] {
  const set = new Set(xs);
  return PROV_ORDER.filter((x) => set.has(x));
}

function validateSupport(channels: SupportChannels): void {
  for (const key of SUPPORT_ORDER) {
    const v = channels[key];
    if (v == null) continue;
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new RangeError(`invalid support channel ${key}`);
  }
}

/**
 * A_i for one channel, inferring the declaration when none is given.
 * A channel already carried as UNAVAILABLE stays applicable: unavailable means "applicable
 * to a required source but not reportable", which is distinct from absent and from
 * inapplicable. Without this, a second representation operation would reinterpret an
 * unavailable channel as inapplicable and silently drop it, so a composed chain could
 * report less refusal than the equivalent direct meet (Theorem 1).
 */
function applicabilityOf(input: TypedEvidence, meaning: SupportMeaning): ChannelApplicability {
  const declared = input.applicability?.[meaning];
  if (declared != null) return declared;
  if ((input.unavailable ?? []).includes(meaning)) {
    return { applicable: true, scope: input.scope?.[meaning] };
  }
  return { applicable: input.support[meaning] != null, scope: input.scope?.[meaning] };
}

/**
 * Evidence meet for representation-only operators.
 * - provenance: set union
 * - support: minimum WITHIN each semantic channel, over the sources the channel applies to
 * - applicability: a channel applicable to a required source but missing a value makes the
 *   output channel UNAVAILABLE (never computed from the remaining sources)
 * - scope: intersection of the applicable sources' declared scopes; empty => unavailable
 * - lineage: union over all sources
 * No comparison is made between unlike meanings.
 */
export function typedMeet(inputs: readonly TypedEvidence[]): TypedEvidence {
  if (inputs.length === 0) throw new RangeError('empty evidence source set');
  const provenance: Provenance[] = [];
  const support: Partial<Record<SupportMeaning, number>> = {};
  const scope: Partial<Record<SupportMeaning, readonly string[]>> = {};
  const unavailable: SupportMeaning[] = [];
  const lineage = new Set<string>();

  for (const input of inputs) {
    validateSupport(input.support);
    provenance.push(...input.provenance);
    for (const src of input.lineage ?? []) lineage.add(src);
  }

  for (const meaning of SUPPORT_ORDER) {
    const applicableSources = inputs.filter((i) => applicabilityOf(i, meaning).applicable);
    // Clause 1: no source declares the channel applicable -> do not invent it.
    if (applicableSources.length === 0) continue;
    // Clause 3: applicable somewhere but missing a value there -> unavailable.
    const missing = applicableSources.some((i) => i.support[meaning] == null);
    // Any source that already carries the channel as unavailable propagates that.
    const inheritedUnavailable = inputs.some((i) => (i.unavailable ?? []).includes(meaning));
    if (missing || inheritedUnavailable) { unavailable.push(meaning); continue; }
    // Clause 4/5: scope is the intersection over applicable sources; empty -> unavailable.
    let terms: readonly string[] | null = null;
    for (const i of applicableSources) {
      const declared = applicabilityOf(i, meaning).scope ?? i.scope?.[meaning];
      if (declared == null) continue;                       // unrestricted: no narrowing
      terms = terms == null ? [...declared] : terms.filter((t) => declared.includes(t));
    }
    if (terms != null && terms.length === 0) { unavailable.push(meaning); continue; }
    // Clause 2: same-channel minimum over the applicable sources.
    let min = Infinity;
    for (const i of applicableSources) min = Math.min(min, i.support[meaning] as number);
    support[meaning] = min;
    if (terms != null) scope[meaning] = terms;
  }

  const out: {
    provenance: Provenance[]; support: Partial<Record<SupportMeaning, number>>;
    unavailable?: SupportMeaning[]; scope?: Partial<Record<SupportMeaning, readonly string[]>>;
    lineage?: string[];
  } = { provenance: normalizeProvenance(provenance), support };
  // Optional fields stay absent when empty, so legacy records round-trip unchanged.
  if (unavailable.length > 0) out.unavailable = SUPPORT_ORDER.filter((m) => unavailable.includes(m));
  if (Object.keys(scope).length > 0) out.scope = scope;
  if (lineage.size > 0) out.lineage = [...lineage].sort();
  return out;
}

export function contourEvidence(
  corners: readonly [TypedCellEvidence, TypedCellEvidence, TypedCellEvidence, TypedCellEvidence],
): TypedEvidence | null {
  if (corners.some((c) => c.state === 'unsupported')) return null;
  return typedMeet(corners as readonly TypedEvidence[]);
}

export function stitchEvidence(a: TypedEvidence, b: TypedEvidence): TypedEvidence {
  return typedMeet([a, b]);
}

export function smoothEvidence(a: TypedEvidence, b: TypedEvidence): TypedEvidence {
  return typedMeet([a, b]);
}
