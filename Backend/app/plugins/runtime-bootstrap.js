import fp from "fastify-plugin";
import { ensureRuntimeBootstrap } from "../services/runtime-bootstrap.service.js";
import { getYoutubeJobService } from "../services/youtube-job.service.js";

export default fp(async function runtimeBootstrapPlugin(fastify) {
  const result = await ensureRuntimeBootstrap();

  if (result.needsSetup) {
    // No runtime config yet — GUI setup required. Decorate with null so VOD
    // routes can detect the uninitialized state and return setup_required.
    fastify.decorate("runtime", { needsSetup: true, appDir: result.appDir });
    fastify.decorate("youtubeJobs", null);
  } else {
    const youtubeJobs = getYoutubeJobService(result);
    fastify.decorate("runtime", result);
    fastify.decorate("youtubeJobs", youtubeJobs);
  }
});
