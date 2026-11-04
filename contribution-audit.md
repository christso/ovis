# Contribution and writing audit — 4 November 2026

Reviewed the published descriptions for upstream PRs #2717, #2718 and #2719, and issue #2716,
using the write-naturally skill and upstream CONTRIBUTING.md, AGENTS.md, server/AGENTS.md,
src/AGENTS.md, .github/REVIEW.md, the PR template and the bug-report template.

The three PRs each target upstream main from independent fix branches, have a scoped fix title,
use the required Change and Validation sections, and contain a Fixed changelog fragment.
Their validation sections distinguish the checks run from skipped full and native suites.
The screenshots and supporting logs remain on this separate evidence branch. No saved-launcher
feature is proposed.

Updated #2718 to name the design references and explain why PC selection follows Ovis's own
remote-PC links. Updated #2716 to include every bug-report field, retaining the source-inspection
limit and marking uncollected live-reproduction details explicitly. The proposal still asks for
maintainer agreement before a PR extending the relay's intentional local-only receipt boundary.

The issue body update succeeded and was fetched back for verification. Assigning its bug label
was rejected by GitHub because the contributor account lacks AddLabelsToLabelable permission;
the issue remains unlabeled. The PR body update also succeeded and was fetched back.

This audit changed GitHub descriptions only. It did not change the application commits.
