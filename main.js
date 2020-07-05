const API_ROOT = "https://online-go.com/api/v1/";

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

class API {
  constructor() {
    this.activeRequestRC = 0;
  }

  async call(method, pathname, query = {}) {
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
    return this.call("GET", pathname, query);
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

async function getRounds() {
  const searchParams = new URLSearchParams(window.location.search);
  const tournamentId = searchParams.get("tournament") || "59567";
  const [player, tournament] = await Promise.all([
    findPlayer(searchParams.get("player")),
    api.get(`tournaments/${tournamentId}/rounds`),
  ]);

  if (!player) {
    return [];
  }

  return tournament.map((round) => {
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

  for (const template of fragment.querySelectorAll("[data-iterate]")) {
    const { items, childData } = data[template.dataset.iterate];

    template.after(
      ...items.map((item) => {
        const fragment = template.content.cloneNode(true);
        fillFragmentData(fragment, childData(item));

        return fragment;
      })
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

async function main() {
  const rounds = await getRounds();
  const template = document.getElementById("template:app/group");
  const fragment = template.content.cloneNode(true);

  fillFragmentData(fragment, {
    rounds: {
      items: rounds,
      childData: (round) => ({
        roundNumber: round.round,
        players: {
          items: round.players,
          childData: ({ id: playerId, games }) => ({
            fetchingPlayer: api.get(`players/${playerId}`).then((player) => ({
              username: player.username,
              playerHref: `https://online-go.com/player/${playerId}`,
              games: {
                items: games,
                childData: ({ gameid: gameId }) => ({
                  fetchingGame: api.get(`games/${gameId}`).then((game) => {
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
            })),
          }),
        },
      }),
    },
  });

  document.body.appendChild(fragment);
}

document.addEventListener("DOMContentLoaded", main);
