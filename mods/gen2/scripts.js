/**
 * Gen 2 scripts.
 */
exports.BattleScripts = {
	gen: 2,
	getCategory: function(move) {
		move = this.getMove(move);
		var specialTypes = {Fire:1, Water:1, Grass:1, Ice:1, Electric:1, Dark:1, Psychic:1, Dragon:1};
		if (move.category === 'Status') return 'Status';
		return specialTypes[move.type]?'Special':'Physical';
	},
	getStatCallback: function (stat, statName, pokemon) {
		// Gen 2 caps stats at 999 and min is 1. Stats over 1023 with items roll over (Marowak, Pikachu)
		if (pokemon.species === 'Marowak' && pokemon.item === 'thickclub' && statName === 'atk' && stat > 1023) {
			stat = stat - 1024;
		} else if (pokemon.species === 'Pikachu' && pokemon.item === 'lightball' && statName === 'spa' && stat > 1023) {
			stat = stat - 1024;
		} else if (pokemon.species === 'Ditto' && pokemon.item === 'metalpowder' && statName in {def:1, spd:1} && stat > 1023) {
			// what. the. fuck. stop playing pokémon
			stat = stat - 1024;
		} else {
			if (stat > 999) stat = 999;
		}
		if (stat < 1) stat = 1;

		return stat;
	},
	getDamage: function(pokemon, target, move, suppressMessages) {
		// We get the move
		if (typeof move === 'string') move = this.getMove(move);
		if (typeof move === 'number') move = {
			basePower: move,
			type: '???',
			category: 'Physical'
		};

		// First of all, we test for immunities
		if (move.affectedByImmunities) {
			if (!target.runImmunity(move.type, true)) {
				return false;
			}
		}

		// Is it ok?
		if (move.ohko) {
			if (target.level > pokemon.level) {
				this.add('-failed', target);
				return false;
			}
			return target.maxhp;
		}
		
		// We edit the damage through move's damage callback
		if (move.damageCallback) {
			return move.damageCallback.call(this, pokemon, target);
		}
		
		// We take damage from damage=level moves
		if (move.damage === 'level') {
			return pokemon.level;
		}
		
		// If there's a fix move damage, we run it
		if (move.damage) {
			return move.damage;
		}

		// There's no move for some reason, create it
		if (!move) {
			move = {};
		}
		
		// We check the category and typing to calculate later on the damage
		move.category = this.getCategory(move);
		if (!move.defensiveCategory) move.defensiveCategory = move.category;
		// '???' is typeless damage: used for Struggle and Confusion etc
		if (!move.type) move.type = '???';
		var type = move.type;
		
		// We get the base power and apply basePowerCallback if necessary
		var basePower = move.basePower;
		if (move.basePowerCallback) {
			basePower = move.basePowerCallback.call(this, pokemon, target, move);
		}
		
		// We check for Base Power
		if (!basePower) {
			if (basePower === 0) return; // Returning undefined means not dealing damage
			return basePower;
		}
		basePower = clampIntRange(basePower, 1);

		// Checking for the move's Critical Hit ratio
		move.critRatio = clampIntRange(move.critRatio, 0, 5);
		var critMult = [0, 16, 8, 4, 3, 2];
		move.crit = move.willCrit || false;
		if (typeof move.willCrit === 'undefined') {
			if (move.critRatio) {
				move.crit = (this.random(critMult[move.critRatio]) === 0);
			}
		}
		if (move.crit) {
			move.crit = this.runEvent('CriticalHit', target, null, move);
		}

		// Happens after crit calculation
		if (basePower) {
			basePower = this.runEvent('BasePower', pokemon, target, move, basePower);
			if (move.basePowerModifier) {
				basePower *= move.basePowerModifier;
			}
		}
		if (!basePower) return 0;
		basePower = clampIntRange(basePower, 1);

		// We now check for attacker and defender
		var level = pokemon.level;
		var attacker = pokemon;
		var defender = target;
		if (move.useTargetOffensive) attacker = target;
		if (move.useSourceDefensive) defender = pokemon;
		var atkType = (move.category === 'Physical')? 'atk' : 'spa';
		var defType = (move.defensiveCategory === 'Physical')? 'def' : 'spd';
		var attack = attacker.getStat(atkType);
		var defense = defender.getStat(defType);

		if (move.crit) {
			move.ignoreNegativeOffensive = true;
			move.ignorePositiveDefensive = true;
		}
		if (move.ignoreNegativeOffensive && attack < attacker.getStat(move.category==='Physical'?'atk':'spa', true)) {
			move.ignoreOffensive = true;
		}
		if (move.ignoreOffensive) {
			this.debug('Negating (sp)atk boost/penalty.');
			attack = attacker.getStat(move.category==='Physical'?'atk':'spa', true);
		}
		if (move.ignorePositiveDefensive && defense > target.getStat(move.defensiveCategory==='Physical'?'def':'spd', true)) {
			move.ignoreDefensive = true;
		}
		if (move.ignoreDefensive) {
			this.debug('Negating (sp)def boost/penalty.');
			defense = target.getStat(move.defensiveCategory==='Physical'?'def':'spd', true);
		}

		// Gen 2 damage formula
		var baseDamage = Math.min(Math.floor(Math.floor(Math.floor(2 * level / 5 + 2) * attack * basePower / defense) / 50), 997) + 2;

		// Crit damage addition (usually doubling)
		if (move.crit) {
			if (!suppressMessages) this.add('-crit', target);
			baseDamage = this.modify(baseDamage, move.critModifier || 2);
		}
		
		// STAB damage bonus, the "???" type never gets STAB
		if (type !== '???' && pokemon.hasType(type)) {
			baseDamage = Math.floor(baseDamage * 1.5);
		}
		
		// Type effectiveness
		var totalTypeMod = this.getEffectiveness(type, target);
		// Super effective attack
		if (totalTypeMod > 0) {
			if (!suppressMessages) this.add('-supereffective', target);
			baseDamage *= 2;
			if (totalTypeMod >= 2) {
				baseDamage *= 2;
			}
		}
		
		// Resisted attack
		if (totalTypeMod < 0) {
			if (!suppressMessages) this.add('-resisted', target);
			baseDamage = Math.floor(baseDamage / 2);
			if (totalTypeMod <= -2) {
				baseDamage = Math.floor(baseDamage / 2);
			}
		}

		// Randomizer, it's a number between 217 and 255
		var randFactor = Math.floor(Math.random()*39)+217;
		baseDamage *= Math.floor(randFactor * 100 / 255) / 100;
		
		// If damage is less than 1, we return 1
		if (basePower && !Math.floor(baseDamage)) {
			return 1;
		}

		// We are done, this is the final damage
		return Math.floor(baseDamage);
	},
	faint: function(pokemon, source, effect) {
		pokemon.faint(source, effect);
		this.queue = [];
	},
runMove: function(move, pokemon, target, sourceEffect) {
		if (!sourceEffect && toId(move) !== 'struggle') {
			var changedMove = this.runEvent('OverrideDecision', pokemon);
			if (changedMove && changedMove !== true) {
				move = changedMove;
				target = null;
			}
		}
		move = this.getMove(move);
		if (!target) target = this.resolveTarget(pokemon, move);

		this.setActiveMove(move, pokemon, target);

		if (pokemon.moveThisTurn) {
			// THIS IS PURELY A SANITY CHECK
			// DO NOT TAKE ADVANTAGE OF THIS TO PREVENT A POKEMON FROM MOVING;
			// USE this.cancelMove INSTEAD
			this.debug(''+pokemon.id+' INCONSISTENT STATE, ALREADY MOVED: '+pokemon.moveThisTurn);
			this.clearActiveMove(true);
			return;
		}
		if (!this.runEvent('BeforeMove', pokemon, target, move)) {
			this.clearActiveMove(true);
			return;
		}
		if (move.beforeMoveCallback) {
			if (move.beforeMoveCallback.call(this, pokemon, target, move)) {
				this.clearActiveMove(true);
				return;
			}
		}
		pokemon.lastDamage = 0;
		var lockedMove = this.runEvent('LockMove', pokemon);
		if (lockedMove === true) lockedMove = false;
		if (!lockedMove) {
			pokemon.deductPP(move, null, target);
		}
		pokemon.moveUsed(move);
		this.useMove(move, pokemon, target, sourceEffect);
		this.singleEvent('AfterMove', move, null, pokemon, target, move);
		this.runEvent('AfterMove', target, pokemon, move);
		this.runEvent('AfterMoveSelf', pokemon, target, move);
	},
	runMove: function(move, pokemon, target, sourceEffect) {
		if (!sourceEffect && toId(move) !== 'struggle') {
			var changedMove = this.runEvent('OverrideDecision', pokemon);
			if (changedMove && changedMove !== true) {
				move = changedMove;
				target = null;
			}
		}
		move = this.getMove(move);
		if (!target) target = this.resolveTarget(pokemon, move);

		this.setActiveMove(move, pokemon, target);

		if (pokemon.moveThisTurn) {
			// THIS IS PURELY A SANITY CHECK
			// DO NOT TAKE ADVANTAGE OF THIS TO PREVENT A POKEMON FROM MOVING;
			// USE this.cancelMove INSTEAD
			this.debug(''+pokemon.id+' INCONSISTENT STATE, ALREADY MOVED: '+pokemon.moveThisTurn);
			this.clearActiveMove(true);
			return;
		}
		if (!this.runEvent('BeforeMove', pokemon, target, move)) {
			this.clearActiveMove(true);
			return;
		}
		if (move.beforeMoveCallback) {
			if (move.beforeMoveCallback.call(this, pokemon, target, move)) {
				this.clearActiveMove(true);
				return;
			}
		}
		pokemon.lastDamage = 0;
		var lockedMove = this.runEvent('LockMove', pokemon);
		if (lockedMove === true) lockedMove = false;
		if (!lockedMove) {
			pokemon.deductPP(move, null, target);
		}
		pokemon.moveUsed(move);
		this.useMove(move, pokemon, target, sourceEffect);
		this.singleEvent('AfterMove', move, null, pokemon, target, move);
		this.runEvent('AfterMove', target, pokemon, move);
		this.runEvent('AfterMoveSelf', pokemon, target, move);
	},runMove: function(move, pokemon, target, sourceEffect) {
		if (!sourceEffect && toId(move) !== 'struggle') {
			var changedMove = this.runEvent('OverrideDecision', pokemon);
			if (changedMove && changedMove !== true) {
				move = changedMove;
				target = null;
			}
		}
		move = this.getMove(move);
		if (!target) target = this.resolveTarget(pokemon, move);

		this.setActiveMove(move, pokemon, target);

		if (pokemon.moveThisTurn) {
			// THIS IS PURELY A SANITY CHECK
			// DO NOT TAKE ADVANTAGE OF THIS TO PREVENT A POKEMON FROM MOVING;
			// USE this.cancelMove INSTEAD
			this.debug(''+pokemon.id+' INCONSISTENT STATE, ALREADY MOVED: '+pokemon.moveThisTurn);
			this.clearActiveMove(true);
			return;
		}
		if (!this.runEvent('BeforeMove', pokemon, target, move)) {
			this.clearActiveMove(true);
			return;
		}
		if (move.beforeMoveCallback) {
			if (move.beforeMoveCallback.call(this, pokemon, target, move)) {
				this.clearActiveMove(true);
				return;
			}
		}
		pokemon.lastDamage = 0;
		var lockedMove = this.runEvent('LockMove', pokemon);
		if (lockedMove === true) lockedMove = false;
		if (!lockedMove) {
			pokemon.deductPP(move, null, target);
		}
		pokemon.moveUsed(move);
		this.useMove(move, pokemon, target, sourceEffect);
		this.singleEvent('AfterMove', move, null, pokemon, target, move);
		this.runEvent('AfterMove', target, pokemon, move);
		this.runEvent('AfterMoveSelf', pokemon, target, move);
	},
	runMove: function(move, pokemon, target, sourceEffect) {
		if (!sourceEffect && toId(move) !== 'struggle') {
			var changedMove = this.runEvent('OverrideDecision', pokemon);
			if (changedMove && changedMove !== true) {
				move = changedMove;
				target = null;
			}
		}
		move = this.getMove(move);
		if (!target) target = this.resolveTarget(pokemon, move);

		this.setActiveMove(move, pokemon, target);

		if (pokemon.moveThisTurn) {
			// THIS IS PURELY A SANITY CHECK
			// DO NOT TAKE ADVANTAGE OF THIS TO PREVENT A POKEMON FROM MOVING;
			// USE this.cancelMove INSTEAD
			this.debug(''+pokemon.id+' INCONSISTENT STATE, ALREADY MOVED: '+pokemon.moveThisTurn);
			this.clearActiveMove(true);
			return;
		}
		if (!this.runEvent('BeforeMove', pokemon, target, move)) {
			this.clearActiveMove(true);
			return;
		}
		if (move.beforeMoveCallback) {
			if (move.beforeMoveCallback.call(this, pokemon, target, move)) {
				this.clearActiveMove(true);
				return;
			}
		}
		pokemon.lastDamage = 0;
		var lockedMove = this.runEvent('LockMove', pokemon);
		if (lockedMove === true) lockedMove = false;
		if (!lockedMove && !move.isSleepTalk) {
			pokemon.deductPP(move, null, target);
		}
		pokemon.moveUsed(move);
		this.useMove(move, pokemon, target, sourceEffect);
		this.singleEvent('AfterMove', move, null, pokemon, target, move);
		this.runEvent('AfterMove', target, pokemon, move);
		this.runEvent('AfterMoveSelf', pokemon, target, move);
	}
};