import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';

describe('RoomManager', () => {
  it('crea sala con código de 6 dígitos en LOBBY_UNCLAIMED y permite reclamar al anfitrión', () => {
    const rm = new RoomManager();
    const room = rm.createRoomForTv('tv-1');
    assert.match(room.code, /^\d{6}$/);
    assert.equal(room.state, 'LOBBY_UNCLAIMED');

    const claim = rm.claimHost(room.code, 'host-1');
    assert.equal(claim.error, undefined);
    assert.ok(claim.hostToken);
    assert.equal(room.state, 'LOBBY');
    assert.equal(rm.validateHost(room, claim.hostToken), true);
    assert.equal(rm.validateHost(room, 'wrong-token'), false);
  });

  it('permite crear equipo con integrantes, unir otro móvil al mismo equipo y reconectar', () => {
    const rm = new RoomManager();
    const room = rm.createRoomForTv('tv-1');
    rm.claimHost(room.code, 'host-1');

    const join1 = rm.joinTeam(room.code, 'p-1', {
      teamName: 'Los Rayos',
      members: ['Ana', 'Luis'],
      createTeam: true,
    });
    assert.equal(join1.error, undefined);
    assert.deepEqual(join1.team.members, ['Ana', 'Luis']);

    // Segundo móvil se une al mismo equipo
    const join2 = rm.joinTeam(room.code, 'p-2', {
      teamName: 'Los Rayos',
      createTeam: false,
    });
    assert.equal(join2.error, undefined);
    assert.equal(join2.team.id, join1.team.id);
    assert.equal(join2.team.sockets.size, 2);

    // Desconexión y reconexión con sessionToken
    rm.handleDisconnect('p-1');
    const rejoin = rm.joinTeam(room.code, 'p-1-new', {
      sessionToken: join1.sessionToken,
    });
    assert.equal(rejoin.reconnected, true);
    assert.equal(rejoin.team.id, join1.team.id);
  });

  it('expulsa un equipo correctamente', () => {
    const rm = new RoomManager();
    const room = rm.createRoomForTv('tv-1');
    const join = rm.joinTeam(room.code, 'p-1', { teamName: 'Equipo X', createTeam: true });
    const kicked = rm.kickTeam(room.code, join.team.id);
    assert.ok(kicked);
    assert.equal(room.teams.size, 0);
  });
});

