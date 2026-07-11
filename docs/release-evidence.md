# Optional Field Evidence Profile

TESSARYN software releases are governed by repository conformance. A physical
deployment is optional and does not gate `0.1.0` or later software versions.

An operator may publish a field-evidence package containing:

1. one authorized 20-40 meter indoor/outdoor site;
2. three capture sessions on distinct dates;
3. original capture request identities and verified public reconstruction
   artifacts;
4. a site-specific privacy review and residual-leakage report;
5. reference-hardware measurements with build commit and fixture digests;
6. an independent operator's byte-identical reconstruction and verification
   receipts;
7. one unresolved reconstruction branch and its source evidence;
8. a networking-disabled replay and verification receipt;
9. any deployment-specific legal or policy records the operator elects to
   disclose.

Code may validate the digital artifacts and signatures in that package. Only
the named operators and reviewers can create external evidence. Absence of a
field package does not make the software incomplete; presence of one does not
upgrade a computational identity claim into proof of physical truth.
