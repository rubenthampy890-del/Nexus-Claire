
import PredictiveMaintenance from './modules/predictiveMaintenance';

const predictiveMaintenance = new PredictiveMaintenance();

predictiveMaintenance.train([
  {
    telemetryData: [1, 2, 3],
    crashStatus: 0,
  },
  {
    telemetryData: [4, 5, 6],
    crashStatus: 1,
  },
]);

predictiveMaintenance.optimizeSystem();
