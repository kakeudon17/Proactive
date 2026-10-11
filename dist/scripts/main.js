// scripts/main.ts
import { world, system, BlockVolume, GameMode } from "@minecraft/server";
var PROACTIVE_ID = "proactive:proactive";
var WARUACTIVE_ID = "proactive:waruactive";
var WIDTH = 16;
var HALF_WIDTH = WIDTH / 2;
var CREATIVE_FILL_HEIGHT = 120;
var WARU_FILL_HEIGHT = 120;
var BEDROCK_ID = "minecraft:bedrock";
function getBounds(centerX, centerZ, minY, maxY) {
  return {
    min: {
      x: centerX - HALF_WIDTH,
      y: minY,
      z: centerZ - HALF_WIDTH
    },
    max: {
      x: centerX + HALF_WIDTH - 1,
      y: maxY,
      z: centerZ + HALF_WIDTH - 1
    }
  };
}
function carveProactiveCreative(dimension, location, minY, maxY) {
  const centerX = Math.floor(location.x);
  const centerZ = Math.floor(location.z);
  let topY = maxY;
  while (topY >= minY) {
    const bottomY = Math.max(minY, topY - CREATIVE_FILL_HEIGHT + 1);
    const { min, max } = getBounds(centerX, centerZ, bottomY, topY);
    try {
      dimension.fillBlocks(new BlockVolume(min, max), "minecraft:air", {
        blockFilter: {
          excludeTypes: [BEDROCK_ID]
        },
        ignoreChunkBoundErrors: true
      });
    } catch (error) {
      console.warn(`[Proactive BP] Creative fill failed at Y=${bottomY}: ${error}`);
    }
    topY = bottomY - 1;
  }
}
function* carveProactiveSurvivalJob(dimension, location, minY, maxY, dropItems) {
  const centerX = Math.floor(location.x);
  const centerZ = Math.floor(location.z);
  for (let y = maxY; y >= minY; y--) {
    const { min, max } = getBounds(centerX, centerZ, y, y);
    const bedrockPositions = [];
    for (let x = min.x; x <= max.x; x++) {
      for (let z = min.z; z <= max.z; z++) {
        try {
          const block = dimension.getBlock({ x, y, z });
          if (block?.typeId === BEDROCK_ID) {
            bedrockPositions.push({ x, y, z });
          }
        } catch {
        }
      }
      yield;
    }
    try {
      dimension.runCommand(
        `fill ${min.x} ${y} ${min.z} ${max.x} ${y} ${max.z} minecraft:air ${dropItems ? "destroy" : "replace"}`
      );
    } catch (error) {
      console.warn(`[Proactive BP] Survival fill failed at Y=${y}: ${error}`);
    }
    for (const pos of bedrockPositions) {
      try {
        dimension.setBlockType(pos, BEDROCK_ID);
      } catch (error) {
        console.warn(`[Proactive BP] Bedrock restore failed: ${error}`);
      }
      yield;
    }
    yield;
  }
}
function* carveWaruactiveJob(dimension, location, minY, maxY) {
  const centerX = Math.floor(location.x);
  const centerZ = Math.floor(location.z);
  for (let y = minY; y <= maxY; y += WARU_FILL_HEIGHT) {
    const endY = Math.min(y + WARU_FILL_HEIGHT - 1, maxY);
    const { min, max } = getBounds(centerX, centerZ, y, endY);
    try {
      dimension.fillBlocks(new BlockVolume(min, max), "minecraft:air", {
        ignoreChunkBoundErrors: true
      });
    } catch (error) {
      console.warn(`[Proactive BP] Waruactive fill failed at Y=${y}: ${error}`);
    }
    yield;
  }
}
world.afterEvents.projectileHitBlock.subscribe((event) => {
  const projectile = event.projectile;
  const id = projectile.typeId;
  if (id !== PROACTIVE_ID && id !== WARUACTIVE_ID) {
    return;
  }
  try {
    const dimension = event.dimension;
    const location = event.location;
    const heightRange = dimension.heightRange;
    const centerY = Math.floor(location.y);
    if (id === PROACTIVE_ID) {
      const minY = Math.max(centerY, heightRange.min);
      const maxY = heightRange.max - 1;
      if (minY > maxY) {
        return;
      }
      const source = event.source;
      let gameMode;
      if (source?.typeId === "minecraft:player") {
        try {
          gameMode = source.getGameMode();
        } catch {
          gameMode = void 0;
        }
      }
      if (gameMode === GameMode.Creative) {
        carveProactiveCreative(dimension, location, minY, maxY);
      } else {
        const dropItems = gameMode === GameMode.Survival;
        system.runJob(carveProactiveSurvivalJob(dimension, location, minY, maxY, dropItems));
      }
    } else {
      system.runJob(carveWaruactiveJob(dimension, location, heightRange.min, heightRange.max - 1));
    }
  } catch (error) {
    console.warn(`[Proactive BP] ${error}`);
  } finally {
    try {
      projectile.remove();
    } catch {
    }
  }
});

//# sourceMappingURL=../debug/main.js.map
