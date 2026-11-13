### Fixed
- Peer messages distinguish Ovis display labels from Herdr reply panes and identify the sender's
  session when verified. Reply guidance avoids mutual waits.
- Received peer messages can gain authenticated sender attribution while the sending CLI still
  waits for agent status, after the exact native envelope and both agent instances are verified.
