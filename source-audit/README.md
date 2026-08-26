# source-audit/

Machine-readable record of the production-source falsification reported in the paper
(Section 4.5). `OLV_v0.6.5_SOURCE_AUDIT.json` identifies the audited OpenLiDARViewer v0.6.5
release (commit, archive SHA-256, DOIs) and the two findings: the `contourEvidence(grade)`
grade-to-provenance export mapping (the executable counterexample) and the `simplifyPolyline`
generalized-export path that does not aggregate complete-source typed evidence.

This audit targets the v0.6.5 application release and is separate from the field-derived Table 3
audit, which runs on a frozen study-local terrain module snapshot.
