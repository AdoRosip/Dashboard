import { runCalibrationForFinishedFixtures } from "../lib/calibration";

runCalibrationForFinishedFixtures()
  .then(() => {
    console.log("Calibration run complete.");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
