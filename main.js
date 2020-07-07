const API_ROOT = "https://online-go.com/api/v1/";

function pipe(init, ...ops) {
  return ops.reduce((state, op) => op(state), init);
}

function map(fn) {
  return function* (items) {
    for (const item of items) {
      yield fn(item);
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

class API {
  constructor() {
    this.activeRequestRC = 0;
  }

  async call(method, pathname, { query = {} } = {}) {
    let tries = 0;
    const url = new URL(pathname, API_ROOT);

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.append(key, value);
    }

    while (this.activeRequestRC > 10) {
      await sleep(500);
    }

    this.activeRequestRC += 1;

    const request = new Request(url, { method });
    let response = await fetch(request);

    while (response.status === 429 || tries > 20) {
      tries += 1;
      await sleep(1000 * tries);
      response = await fetch(request);
    }

    this.activeRequestRC -= 1;

    return response.json();
  }

  get(pathname, query) {
    return this.call("GET", pathname, { query });
  }

  async *stream(pathname, query) {
    let page = await this.call("GET", pathname, { query });

    while (page.next) {
      for (const result of page.results) {
        yield result;
      }

      page = await this.call("GET", page.next);
    }
  }
}

const api = new API();

async function findPlayer(username) {
  if (!username) {
    return null;
  }

  const { results } = await api.get("players", { username });

  return results.find((player) => player.username === username);
}

async function getRounds(tournamentId) {
  const rounds = await api.get(`tournaments/${tournamentId}/rounds`);

  return rounds.map((round) => {
    const groups = [];

    for (const match of round.matches) {
      let group = groups.find(
        (group) =>
          group.players.has(match.black) || group.players.has(match.white)
      );

      if (!group) {
        group = { players: new Set(), games: new Set() };
        groups.push(group);
      }

      group.games.add(match.gameid);
      group.players.add(match.black);
      group.players.add(match.white);
    }

    return {
      roundNumber: round.round_number,
      groups,
    };
  });
}

async function getPlayerRounds(tournamentId, username) {
  const [player, rounds] = await Promise.all([
    findPlayer(username),
    api.get(`tournaments/${tournamentId}/rounds`),
  ]);

  return rounds.map((round) => {
    const opponents = round.matches
      .filter(({ black, white }) => black === player.id || white === player.id)
      .map(({ black, white }) => (black === player.id ? white : black));

    const players = [player.id, ...opponents];

    // Filter out just the games that was played in this group.
    const games = round.matches.filter(({ black }) =>
      players.some((id) => id === black)
    );

    return {
      round: round.round_number,
      players: players.map((id) => ({
        id,
        games: games.filter(({ black, white }) => black === id || white === id),
      })),
    };
  });
}

function getResult(gamedata) {
  if (gamedata.phase !== "finished") {
    return `(${gamedata.moves.length})`;
  }

  const winner = gamedata.winner === gamedata.players.black.id ? "B" : "W";

  return `${winner} + ${gamedata.outcome}`;
}

function fillFragmentData(fragment, data) {
  for (const node of fragment.querySelectorAll("[data-text]")) {
    node.textContent = data[node.dataset.text];
  }

  for (const node of fragment.querySelectorAll("[data-props]")) {
    for (const prop of node.dataset.props.split(" ")) {
      const [key, value] = prop.split(":");
      node[key] = data[value];
    }
  }

  for (const node of fragment.querySelectorAll("[data-dataset]")) {
    for (const prop of node.dataset.dataset.split(" ")) {
      const [key, value] = prop.split(":");
      node.dataset[key] = data[value];
    }
  }

  for (const template of fragment.querySelectorAll("[data-iterate]")) {
    const { items, childData } = data[template.dataset.iterate] || {};

    if (!items) {
      console.log(template.dataset.iterate, data);
      return;
    }

    template.after(
      ...pipe(
        items,
        map((item) => {
          const fragment = template.content.cloneNode(true);
          fillFragmentData(fragment, childData(item));

          return fragment;
        })
      )
    );
  }

  for (const template of fragment.querySelectorAll("[data-await]")) {
    const gettingData = data[template.dataset.await];

    if (!gettingData) {
      return;
    }

    const fragment = template.content.cloneNode(true);

    gettingData.then((data) => {
      fillFragmentData(fragment, data);
      template.after(fragment);
    });
  }
}

async function renderGroups(tournamentId) {
  const rounds = await getRounds(tournamentId);
  const template = document.getElementById("template:app/groups");
  const fragment = template.content.cloneNode(true);

  fillFragmentData(fragment, {
    rounds: {
      items: rounds,
      childData: (round) => ({
        roundNumber: round.roundNumber,
        groups: {
          items: round.groups,
          childData: (group) => ({
            players: {
              items: group.players,
              childData: (playerId) => ({
                playerId,
                playerHref: `https://online-go.com/player/${playerId}`,
                username: playerId,
                points: "–",
              }),
            },
          }),
        },
      }),
    },
  });

  document.body.appendChild(fragment);

  for await (const participant of api.stream(
    `tournaments/${tournamentId}/players`
  )) {
    const playerId = participant.player.id;

    const playerEls = document.body.querySelectorAll(
      `.player-list .player[data-player-id="${playerId}"]`
    );

    for (const playerEl of playerEls) {
      playerEl.classList.remove("loading");

      const usernameEl = playerEl.querySelector("[data-text='username']");
      usernameEl.textContent = participant.player.username;

      const pointsEl = playerEl.querySelector("[data-text='points']");
      pointsEl.textContent = Number.parseInt(participant.points, 10);
    }
  }
}

async function renderPlayerGroup(tournamentId, username) {
  const rounds = await getPlayerRounds(tournamentId, username);
  const template = document.getElementById("template:app/player-group");
  const fragment = template.content.cloneNode(true);

  fillFragmentData(fragment, {
    rounds: {
      items: rounds,
      childData: (round) => ({
        roundNumber: round.round,
        players: {
          items: round.players,
          childData: ({ id: playerId, games }) => ({
            fetchingPlayer: api
              .get(`tournaments/${tournamentId}/players`, {
                player_id: playerId,
              })
              .then(
                ({ results: [participant] }) =>
                  console.log(participant) || {
                    username: participant.player.username,
                    playerHref: `https://online-go.com/player/${playerId}`,
                    games: {
                      items: games,
                      childData: ({ gameid: gameId }) => ({
                        fetchingGame: api
                          .get(`games/${gameId}`)
                          .then((game) => {
                            const isBlack = game.players.black.id === playerId;
                            const opponent = isBlack
                              ? game.players.white
                              : game.players.black;

                            return {
                              color: isBlack ? "Black" : "White",
                              gameHref: `https://online-go.com/game/${gameId}`,
                              opponent: opponent.username,
                              opponentHref: `https://online-go.com/player/${opponent.id}`,
                              result: getResult(game.gamedata),
                            };
                          }),
                      }),
                    },
                  }
              ),
          }),
        },
      }),
    },
  });

  document.body.appendChild(fragment);
}

async function main() {
  const searchParams = new URLSearchParams(window.location.search);
  const username = searchParams.get("player");
  const tournamentId = searchParams.get("tournament") || "59567";

  if (username) {
    renderPlayerGroup(tournamentId, username);
  } else {
    renderGroups(tournamentId);
  }
}

document.addEventListener("DOMContentLoaded", main);
