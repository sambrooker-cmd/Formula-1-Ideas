// Every view in Pit Wall, grouped, with a line on what each is for. Drives the "All views"
// menu so nothing is only reachable by knowing where to look.

export type Needs = 'session' | 'race' | 'practice' | 'none';

export interface View {
  path: string;
  title: string;
  about: string;
  /** What has to be open for it to work. */
  needs: Needs;
}

export interface ViewGroup {
  title: string;
  views: View[];
}

export const CATALOG: ViewGroup[] = [
  {
    title: 'Watch',
    views: [
      { path: '/wall', title: 'Pit wall', about: 'Map, timing, race control, telemetry and strategy on one screen', needs: 'session' },
      { path: '/companion', title: 'TV companion', about: 'Map, timing and race control for a tablet next to the TV', needs: 'session' },
      { path: '/3d', title: '3D replay', about: 'The race in 3D: chase, on-board, TV and free cameras', needs: 'session' },
      { path: '/tv', title: 'TV mode', about: 'Big, simple full-screen graphics for the television', needs: 'session' },
      { path: '/driver', title: 'Driver dashboard', about: 'Everything about one driver', needs: 'session' },
      { path: '/cockpit', title: 'Virtual cockpit', about: 'Gear, speed, pedals, g-forces and delta from inside the car', needs: 'session' },
      { path: '/strip', title: 'Timing strip', about: 'Positions and gaps in a small window', needs: 'session' },
      { path: '/report', title: 'Race report', about: 'A written summary of the session (hidden until you ask)', needs: 'session' },
    ],
  },
  {
    title: 'Follow the race',
    views: [
      { path: '/commentary', title: 'Commentary', about: "Who's closing, who's in range, tyre offsets", needs: 'race' },
      { path: '/moments', title: 'Key moments', about: 'Every pass, stop and flag; catch-up highlights', needs: 'session' },
      { path: '/radio', title: 'Team radio', about: 'Every clip, with transcripts where made', needs: 'session' },
      { path: '/predictor', title: 'Predictor', about: 'Projected finish (race) or the knockout picture (qualifying)', needs: 'session' },
      { path: '/battles', title: 'Battles', about: 'On-track fights and who got through', needs: 'race' },
      { path: '/pit-battles', title: 'Pit battles', about: 'Undercuts and overcuts, and whether they worked', needs: 'race' },
      { path: '/championship', title: 'Championship', about: 'The standings as they would be now', needs: 'race' },
    ],
  },
  {
    title: 'Analyse',
    views: [
      { path: '/analysis', title: 'Analysis page', about: 'All the deeper tools in one place', needs: 'session' },
      { path: '/ghost', title: 'Ghost lap', about: 'Two laps raced against each other', needs: 'session' },
      { path: '/corners', title: 'Corners', about: 'Speed, braking and exit for every corner', needs: 'session' },
      { path: '/compare', title: 'Fastest laps', about: 'Telemetry of two laps overlaid', needs: 'session' },
      { path: '/tyre-deg', title: 'Tyre degradation', about: 'How fast each compound wears', needs: 'race' },
      { path: '/clean-air', title: 'Clean-air pace', about: 'True pace, without traffic', needs: 'race' },
      { path: '/strategy-sim', title: 'Strategy simulator', about: 'Change a strategy, see where they would have finished', needs: 'race' },
      { path: '/overtakes', title: 'Overtakes', about: 'Where on the lap the passes happened', needs: 'race' },
      { path: '/starts', title: 'The start', about: 'Grid to the end of lap 1', needs: 'race' },
      { path: '/ratings', title: 'Driver ratings', about: 'A mark out of 10 for every driver, with reasons', needs: 'race' },
      { path: '/race-trace', title: 'Race trace', about: 'Gaps to the leader, lap by lap', needs: 'race' },
      { path: '/positions', title: 'Positions', about: 'Places lap by lap', needs: 'race' },
      { path: '/tyre-wear', title: 'Tyre wear', about: 'Lap times through each stint', needs: 'race' },
      { path: '/strategy', title: 'Tyre strategy', about: 'Everyone’s stints at a glance', needs: 'session' },
      { path: '/long-runs', title: 'Long runs', about: 'Race pace from practice (or stint pace in a race)', needs: 'session' },
      { path: '/strategy-plan', title: 'Race strategy planner', about: 'The quickest plan for Sunday, from practice', needs: 'practice' },
    ],
  },
  {
    title: 'Season and history',
    views: [
      { path: '/season-stats', title: 'Season stats', about: 'Title maths, form guide, pit stops, team pace', needs: 'none' },
      { path: '/driver-season', title: 'Drivers', about: 'Each driver’s season', needs: 'none' },
      { path: '/circuit', title: 'Circuit guide', about: 'Layout, weather, radar, history, overtaking, Safety Car odds', needs: 'none' },
      { path: '/head-to-head', title: 'Head to head', about: 'Any two drivers since 1950, era-adjusted', needs: 'none' },
      { path: '/predictions', title: 'Predictions', about: 'Pick the podium before each race', needs: 'none' },
      { path: '/on-this-day', title: 'On this day', about: 'Races and birthdays on today’s date', needs: 'none' },
    ],
  },
];
