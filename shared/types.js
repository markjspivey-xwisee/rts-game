// ═══════════════════════════════════════════════════════════════════════════
//  JSDoc Type Definitions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} TownCenter
 * @property {number} x
 * @property {number} y
 * @property {number} hp
 * @property {number} maxHp
 */

/**
 * @typedef {Object} Stockpile
 * @property {number} wood
 * @property {number} stone
 * @property {number} gold
 * @property {number} food
 */

/**
 * @typedef {Object} XP
 * @property {number} wood
 * @property {number} stone
 * @property {number} gold
 * @property {number} food
 * @property {number} combat
 * @property {number} build
 */

/**
 * @typedef {Object} Unit
 * @property {number} id
 * @property {number} x
 * @property {number} y
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} carry
 * @property {string|null} carryType
 * @property {number} maxCarry
 * @property {string|null} cmd
 * @property {number|null} targetId
 * @property {string|null} buildType
 * @property {number} buildX
 * @property {number} buildY
 * @property {number} moveX
 * @property {number} moveY
 * @property {string|null} tag
 * @property {XP} xp
 * @property {string} spec
 * @property {number} specLv
 * @property {number} gSpd
 * @property {number} bSpd
 * @property {number} dmg
 * @property {boolean} alive
 * @property {number} atkCd
 * @property {number} abCd
 * @property {string} [owner] - player id
 * @property {boolean} [enemy] - true if this is an enemy villager (bot)
 * @property {boolean} [raiding] - true if on a raid
 */

/**
 * @typedef {Object} Enemy
 * @property {number} id
 * @property {number} x
 * @property {number} y
 * @property {string} type
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} dmg
 * @property {number} spd
 * @property {boolean} ranged
 * @property {number} range
 * @property {boolean} alive
 * @property {number} atkCd
 * @property {number} moveCd
 */

/**
 * @typedef {Object} Building
 * @property {number} id
 * @property {string} type
 * @property {number} x
 * @property {number} y
 * @property {number} hp
 * @property {number} maxHp
 * @property {boolean} built
 */

/**
 * @typedef {Object} Resource
 * @property {number} id
 * @property {string} type
 * @property {number} x
 * @property {number} y
 * @property {number} amount
 * @property {number} maxAmt
 * @property {number} rg - regrowth rate
 */

/**
 * @typedef {Object} BuildQueueItem
 * @property {number} bId - builder unit id
 * @property {string} type
 * @property {number} x
 * @property {number} y
 * @property {number} prog
 * @property {number} need
 * @property {boolean} done
 */

/**
 * @typedef {Object} Particle
 * @property {number} x
 * @property {number} y
 * @property {string} txt
 * @property {string} c - color
 * @property {number} life
 * @property {number} ml - max life
 * @property {number} alpha
 */

/**
 * @typedef {Object} PlayerStats
 * @property {number} kills
 * @property {number} deaths
 * @property {{wood:number, stone:number, gold:number, food:number}} gathered
 * @property {number} built
 * @property {number} maxPop
 * @property {number} wavesEndured
 * @property {Object<number, number>} specLevels
 */

/**
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} name
 * @property {"human"|"api"|"bot"} type
 * @property {string} color
 * @property {TownCenter} tc
 * @property {Unit[]} units
 * @property {Building[]} buildings
 * @property {Stockpile} stockpile
 * @property {Uint8Array[]} fog
 * @property {number} popCap
 * @property {Object} memory
 * @property {PlayerStats} stats
 * @property {boolean} eliminated
 * @property {{x:number, y:number}} spawnPos
 * @property {BuildQueueItem[]} buildQueue
 */

/**
 * @typedef {Object} GameConfig
 * @property {number} playerCount - 2-4
 * @property {string[]} playerNames
 * @property {string[]} playerTypes - "human"|"api"|"bot"
 * @property {boolean} enablePvE
 */

/**
 * @typedef {Object} GameState
 * @property {number} tick
 * @property {Uint8Array[]} terrain
 * @property {Resource[]} resources
 * @property {Player[]} players
 * @property {Enemy[]} enemies - neutral PvE enemies
 * @property {string[]} log
 * @property {Particle[]} particles
 * @property {boolean} gameOver
 * @property {string|null} winner - player id of winner
 * @property {boolean} paused
 * @property {number} nextUid
 * @property {boolean} enablePvE
 */

/**
 * @typedef {Object} PlayerView
 * @property {Unit[]} villagers
 * @property {Enemy[]} enemies
 * @property {Resource[]} resources
 * @property {Stockpile} stockpile
 * @property {Building[]} buildings
 * @property {TownCenter} tc
 * @property {TownCenter|null} enemyTc
 * @property {number} tick
 * @property {number} popCap
 * @property {Set<string>} tech
 * @property {Object} memory
 */

/**
 * @typedef {Object} Command
 * @property {number} unitId
 * @property {string} cmd - "gather"|"build"|"attack"|"moveTo"|"ability"|"idle"
 * @property {number} [targetId]
 * @property {string} [buildType]
 * @property {number} [buildX]
 * @property {number} [buildY]
 * @property {number} [moveX]
 * @property {number} [moveY]
 * @property {string} [tag]
 */

export {};
