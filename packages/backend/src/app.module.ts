import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { existsSync } from "fs";
import { join } from "path";
import { DatabaseModule } from "./database/database.module";
import { ZamaModule } from "./zama/zama.module";

const localEnv = join(__dirname, "..", ".env");
const fallbackEnv = join(process.cwd(), ".env");
const envFilePath = existsSync(localEnv) ? localEnv : fallbackEnv;

if (!existsSync(envFilePath)) {
  // eslint-disable-next-line no-console
  console.warn(
    `[ConfigModule] .env file not found.\n  Looked in: ${localEnv}\n             ${fallbackEnv}`,
  );
} else {
  // eslint-disable-next-line no-console
  console.log(`[ConfigModule] loading .env from ${envFilePath}`);
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath }), DatabaseModule, ZamaModule],
})
export class AppModule {}
