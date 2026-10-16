import { world, system, BlockVolume, GameMode, type Dimension, type Player, type Vector3 } from "@minecraft/server";

const PROACTIVE_ID = "proactive:proactive";
const WARUACTIVE_ID = "proactive:waruactive";

const WIDTH = 16;
const HALF_WIDTH = WIDTH / 2;
const CREATIVE_FILL_HEIGHT = 120;
const WARU_FILL_HEIGHT = 120;
const PROTECTED_BLOCK_IDS = ["minecraft:bedrock", "minecraft:end_portal", "minecraft:end_portal_frame"];

function getBounds(centerX: number, centerZ: number, minY: number, maxY: number) {
    return {
        min: {
            x: centerX - HALF_WIDTH,
            y: minY,
            z: centerZ - HALF_WIDTH,
        },
        max: {
            x: centerX + HALF_WIDTH - 1,
            y: maxY,
            z: centerZ + HALF_WIDTH - 1,
        },
    };
}

// クリエイティブ：上から下へ高速一括処理。
// 保護対象ブロックはフィルターで除外する。
function carveProactiveCreative(dimension: Dimension, location: Vector3, minY: number, maxY: number): void {
    const centerX = Math.floor(location.x);
    const centerZ = Math.floor(location.z);

    let topY = maxY;

    while (topY >= minY) {
        const bottomY = Math.max(minY, topY - CREATIVE_FILL_HEIGHT + 1);

        const { min, max } = getBounds(centerX, centerZ, bottomY, topY);

        try {
            dimension.fillBlocks(new BlockVolume(min, max), "minecraft:air", {
                blockFilter: {
                    excludeTypes: PROTECTED_BLOCK_IDS,
                },
                ignoreChunkBoundErrors: true,
            });
        } catch (error) {
            console.warn(`[Proactive BP] Creative fill failed at Y=${bottomY}: ${error}`);
        }

        topY = bottomY - 1;
    }
}

// サバイバル：16×16×16以内の範囲をまとめて処理。
// 保護対象ブロックを保存し、destroy モードで破壊してから復元する。
function* carveProactiveSurvivalJob(
    dimension: Dimension,
    location: Vector3,
    minY: number,
    maxY: number,
    dropItems: boolean
): Generator<void> {
    const centerX = Math.floor(location.x);
    const centerZ = Math.floor(location.z);

    for (let topY = maxY; topY >= minY; topY -= 16) {
        const bottomY = Math.max(minY, topY - 15);
        const { min, max } = getBounds(centerX, centerZ, bottomY, topY);

        const protectedBlocks: { position: Vector3; typeId: string }[] = [];
        let hasBreakableBlock = false;

        // 16×16×16の保護対象ブロックを確認。16ブロックごとに処理を譲る。
        for (let x = min.x; x <= max.x; x++) {
            for (let z = min.z; z <= max.z; z++) {
                for (let y = bottomY; y <= topY; y++) {
                    try {
                        const block = dimension.getBlock({ x, y, z });

                        if (!block || block.isAir) {
                            continue;
                        }

                        if (PROTECTED_BLOCK_IDS.includes(block.typeId)) {
                            protectedBlocks.push({
                                position: { x, y, z },
                                typeId: block.typeId,
                            });
                        } else {
                            hasBreakableBlock = true;
                        }
                    } catch {
                        // 読み取れないブロックはスキップ
                    }
                }

                yield;
            }
        }

        if (hasBreakableBlock) {
            // 16×16×16以内なら1回で処理
            try {
                dimension.runCommand(
                    `fill ${min.x} ${bottomY} ${min.z} ` +
                        `${max.x} ${topY} ${max.z} ` +
                        `minecraft:air ${dropItems ? "destroy" : "replace"}`
                );
            } catch (error) {
                console.warn(`[Proactive BP] Survival fill failed at Y=${bottomY}: ${error}`);
            }
        }

        // 保護対象ブロックを復元
        for (const { position, typeId } of protectedBlocks) {
            try {
                dimension.setBlockType(position, typeId);
            } catch (error) {
                console.warn(`[Proactive BP] Protected block restore failed: ${error}`);
            }

            yield;
        }

        yield;
    }
}

// waruactive：高さ全体を空気に置換。
// 1回あたり最大30,720ブロック。
function* carveWaruactiveJob(dimension: Dimension, location: Vector3, minY: number, maxY: number): Generator<void> {
    const centerX = Math.floor(location.x);
    const centerZ = Math.floor(location.z);

    for (let y = minY; y <= maxY; y += WARU_FILL_HEIGHT) {
        const endY = Math.min(y + WARU_FILL_HEIGHT - 1, maxY);

        const { min, max } = getBounds(centerX, centerZ, y, endY);

        try {
            dimension.fillBlocks(new BlockVolume(min, max), "minecraft:air", {
                ignoreChunkBoundErrors: true,
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
        const maxBlockY = heightRange.max - 1;

        if (id === PROACTIVE_ID) {
            const minY = Math.max(Math.floor(location.y), heightRange.min);
            const maxY = maxBlockY;

            if (minY > maxY) {
                return;
            }

            const source = event.source;
            let gameMode: GameMode | undefined;

            if (source?.typeId === "minecraft:player") {
                try {
                    gameMode = (source as Player).getGameMode();
                } catch {
                    gameMode = undefined;
                }
            }

            if (gameMode === GameMode.Creative) {
                // クリエイティブは即時処理
                carveProactiveCreative(dimension, location, minY, maxY);
            } else {
                // サバイバルは処理を分散
                const dropItems = gameMode === GameMode.Survival;

                system.runJob(carveProactiveSurvivalJob(dimension, location, minY, maxY, dropItems));
            }
        } else {
            // waruactive は高さ全体をくり抜く
            system.runJob(carveWaruactiveJob(dimension, location, heightRange.min, maxBlockY));
        }
    } catch (error) {
        console.warn(`[Proactive BP] ${error}`);
    } finally {
        try {
            projectile.remove();
        } catch {
            // 既に削除されている場合は無視
        }
    }
});
