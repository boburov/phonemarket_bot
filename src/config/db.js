import mongoose from "mongoose";
import env from "./env.js";
import logger from "./logger.js";

mongoose.set("strictQuery", true);

export const connectDB = async () => {
  await mongoose.connect(env.MONGO_URL);
  logger.info("MongoDB ulandi");
};

export const disconnectDB = async () => {
  await mongoose.disconnect();
  logger.info("MongoDB uzildi");
};
