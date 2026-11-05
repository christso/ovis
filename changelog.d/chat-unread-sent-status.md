### Fixed
- Sends made before the chat's first read show compact sent status with expandable text instead of
  a full faded bubble that could duplicate a native turn when clocks differ. Matching is unchanged;
  ambiguous status may remain until the existing 60-second timeout.
