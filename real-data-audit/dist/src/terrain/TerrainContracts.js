"use strict";
/**
 * TerrainContracts.ts
 *
 * The internal type contracts that every part of the terrain
 * intelligence subsystem speaks. Pure data: no DOM, no three.js, no
 * I/O — so the same shape names mean the same thing in the worker,
 * the cache, the engine, and any future UI surface.
 *
 * These are the base type contracts; the engine that uses them stays an
 * internal seam. The user-facing terrain products shipped in v0.4.x — ground
 * classification, DTM / DSM, canopy height, contours, hillshade, slope — are
 * produced by the separate `src/terrain/contour|ground|surface` pipeline and
 * surfaced through the Analyse panel.
 *
 * Honesty contract — EVERY result MUST carry:
 *   - `coverage`: did we analyse the full cloud, only resident
 *     streaming nodes, or a sampled subset?
 *   - `sourcePointCount`: how many points the input declared.
 *   - `analyzedPointCount`: how many points we actually walked.
 *   - `confidence`: a 0–100 summary the UI shows as a badge.
 *   - `warnings`: an ordered list of strings explaining any
 *     reduction in quality (e.g. "sampled — coverage 18%",
 *     "streaming resident-only — may refine as nodes stream in").
 *
 * Future terrain results MUST NOT imply full-cloud certainty when
 * only a partial set was analysed. The contract enforces that the
 * fields exist; the analyser populates them honestly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
