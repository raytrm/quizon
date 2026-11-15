import { v4 as uuidv4 } from 'uuid';

/**
 * Crea y administra las salas de QUIZÓN, sus equipos y tokens de reconexión.
 */
export class RoomManager {
  constructor() {
    /** @type {Map<string, object>} roomCode -> room */
    this.rooms = new Map();
    /** @type {Map<string, { roomCode: string, role: string, teamId?: string }>} */
    this.socketIndex = new Map();
  }

  /**
   * Genera un código numérico único de 6 dígitos (100000-999999).
   */
  generateRoomCode() {
    let code;
    let attempts = 0;
    do {
      code = String(Math.floor(100000 + Math.random() * 900000));
      attempts++;
      if (attempts > 1000) {
        throw new Error('No hay códigos de sala disponibles.');
      }
    } while (this.rooms.has(code));
    return code;
  }

  /**
   * Crea una nueva sala iniciada desde la TV (en estado LOBBY_UNCLAIMED).
   */
  createRoomForTv(tvSocketId) {
    const code = this.generateRoomCode();
    const room = {
      code,
      state: 'LOBBY_UNCLAIMED',
      tvSocketId,
      hostSocketId: null,
      hostToken: null,
      config: {
        title: 'Noche de QUIZÓN',
        packId: 'all',
        questionCount: 10,
        timeMultiplier: 1.0,
        autoAdvance: false,
        lateJoin: true,
      },
      audio: {
        muted: false,
        volume: 0.8,
      },
      /** @type {Map<string, object>} teamId -> team */
      teams: new Map(),
      /** @type {Map<string, string>} sessionToken -> teamId */
      sessions: new Map(),
      game: null,
      createdAt: Date.now(),
    };

    this.rooms.set(code, room);
    if (tvSocketId) {
      this.socketIndex.set(tvSocketId, { roomCode: code, role: 'tv' });
    }
    return room;
  }

  getRoom(code) {
    return this.rooms.get(String(code || '').trim()) || null;
  }

  /**
   * Reconecta o reasigna la pantalla TV a una sala existente.
   */
  attachTv(code, tvSocketId) {
    const room = this.getRoom(code);
    if (!room) return null;
    if (room.tvSocketId && room.tvSocketId !== tvSocketId) {
      this.socketIndex.delete(room.tvSocketId);
    }
    room.tvSocketId = tvSocketId;
    this.socketIndex.set(tvSocketId, { roomCode: room.code, role: 'tv' });
    return room;
  }

  /**
   * Vincula al anfitrión con la sala usando el código de 6 dígitos (o reconecta con hostToken).
   */
  claimHost(code, hostSocketId, hostToken = null) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: 'ROOM_NOT_FOUND', message: 'No existe ninguna sala con ese código.' };
    }

    if (room.hostToken) {
      if (hostToken && hostToken === room.hostToken) {
        if (room.hostSocketId && room.hostSocketId !== hostSocketId) {
          this.socketIndex.delete(room.hostSocketId);
        }
        room.hostSocketId = hostSocketId;
        this.socketIndex.set(hostSocketId, { roomCode: room.code, role: 'host' });
        return { room, hostToken: room.hostToken, reclaimed: true };
      }
      if (room.hostSocketId) {
        return { error: 'HOST_ALREADY_CLAIMED', message: 'Esta sala ya tiene un anfitrión conectado.' };
      }
      // Si el anfitrión anterior se desconectó y alguien reclama con el código, permitimos retomar si no hay host activo
    }

    const newHostToken = hostToken || uuidv4();
    room.hostToken = newHostToken;
    room.hostSocketId = hostSocketId;
    if (room.state === 'LOBBY_UNCLAIMED') {
      room.state = 'LOBBY';
    }
    this.socketIndex.set(hostSocketId, { roomCode: room.code, role: 'host' });
    return { room, hostToken: newHostToken, reclaimed: false };
  }

  validateHost(room, hostToken) {
    return Boolean(room && hostToken && room.hostToken === hostToken);
  }

  /**
   * Une un móvil a un equipo existente, crea uno nuevo con lista de integrantes,
   * o reconecta mediante sessionToken.
   */
  joinTeam(
    code,
    socketId,
    { teamName, members = [], color = null, icon = null, createTeam = true, sessionToken = null }
  ) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: 'ROOM_NOT_FOUND', message: 'Código de sala no encontrado.' };
    }

    // 1. Intentar reconexión por sessionToken
    if (sessionToken && room.sessions.has(sessionToken)) {
      const teamId = room.sessions.get(sessionToken);
      const existingTeam = room.teams.get(teamId);
      if (existingTeam) {
        existingTeam.sockets.add(socketId);
        existingTeam.connected = true;
        this.socketIndex.set(socketId, { roomCode: room.code, role: 'player', teamId });
        return { room, team: existingTeam, sessionToken, reconnected: true };
      }
    }

    const gameStarted = room.state !== 'LOBBY_UNCLAIMED' && room.state !== 'LOBBY';
    if (gameStarted && !room.config.lateJoin) {
      return { error: 'GAME_IN_PROGRESS', message: 'La partida ya ha comenzado y no admite nuevos equipos.' };
    }

    const cleanName = String(teamName || '').trim();
    if (!cleanName) {
      return { error: 'INVALID_TEAM_NAME', message: 'Debes indicar un nombre de equipo.' };
    }

    const normalizedName = cleanName.toLowerCase();
    const foundTeam = Array.from(room.teams.values()).find(
      (t) => t.name.toLowerCase() === normalizedName
    );

    if (createTeam) {
      if (foundTeam) {
        return { error: 'TEAM_EXISTS', message: `Ya existe un equipo llamado "${foundTeam.name}". Únete a él o elige otro nombre.` };
      }
      const cleanMembers = (Array.isArray(members) ? members : [])
        .map((m) => String(m || '').trim())
        .filter(Boolean);

      const safeColor = /^#[0-9a-fA-F]{6}$/.test(String(color || '').trim())
        ? String(color).trim()
        : '#6366f1';
      const safeIcon = String(icon || '').trim().slice(0, 8) || '🎯';

      const teamId = uuidv4();
      const newToken = uuidv4();
      const team = {
        id: teamId,
        name: cleanName,
        members: cleanMembers,
        color: safeColor,
        icon: safeIcon,
        score: 0,
        streak: 0,
        bestStreak: 0,
        correctCount: 0,
        totalResponseMs: 0,
        connected: true,
        sockets: new Set([socketId]),
      };
      room.teams.set(teamId, team);
      room.sessions.set(newToken, teamId);
      this.socketIndex.set(socketId, { roomCode: room.code, role: 'player', teamId });
      return { room, team, sessionToken: newToken, reconnected: false };
    }

    // Unirse a equipo existente
    if (!foundTeam) {
      return { error: 'TEAM_NOT_FOUND', message: `No se encontró el equipo "${cleanName}".` };
    }

    const newToken = uuidv4();
    foundTeam.sockets.add(socketId);
    foundTeam.connected = true;
    room.sessions.set(newToken, foundTeam.id);
    this.socketIndex.set(socketId, { roomCode: room.code, role: 'player', teamId: foundTeam.id });
    return { room, team: foundTeam, sessionToken: newToken, reconnected: false };
  }

  /**
   * Expulsa un equipo de la sala.
   */
  kickTeam(code, teamId) {
    const room = this.getRoom(code);
    if (!room) return null;
    const team = room.teams.get(teamId);
    if (!team) return null;

    const kickedSockets = Array.from(team.sockets);
    for (const sid of kickedSockets) {
      this.socketIndex.delete(sid);
    }
    for (const [tok, tId] of room.sessions.entries()) {
      if (tId === teamId) room.sessions.delete(tok);
    }
    room.teams.delete(teamId);
    return { team, kickedSockets };
  }

  /**
   * Maneja la desconexión de un socket sin destruir la sala inmediatamente.
   */
  handleDisconnect(socketId) {
    const info = this.socketIndex.get(socketId);
    if (!info) return null;
    this.socketIndex.delete(socketId);

    const room = this.getRoom(info.roomCode);
    if (!room) return null;

    if (info.role === 'tv' && room.tvSocketId === socketId) {
      room.tvSocketId = null;
    } else if (info.role === 'host' && room.hostSocketId === socketId) {
      room.hostSocketId = null;
    } else if (info.role === 'player' && info.teamId) {
      const team = room.teams.get(info.teamId);
      if (team) {
        team.sockets.delete(socketId);
        team.connected = team.sockets.size > 0;
      }
    }

    return { room, ...info };
  }

  /**
   * Serializa la lista pública de equipos para TV y Host.
   */
  serializeTeams(room) {
    return Array.from(room.teams.values()).map((t) => ({
      id: t.id,
      name: t.name,
      members: t.members,
      color: t.color || '#6366f1',
      icon: t.icon || '🎯',
      score: t.score,
      streak: t.streak,
      bestStreak: t.bestStreak,
      connected: t.connected,
      deviceCount: t.sockets.size,
    }));
  }
}

