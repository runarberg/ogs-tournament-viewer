const API_ROOT = "https://online-go.com/api/v1";

async function findPlayer(username) {
  if (!username) {
    return null;
  }

  const playersResponse = await fetch(
    `${API_ROOT}/players?username=${username}`
  );
  const playersResult = await playersResponse.json();

  return playersResult.results.find((player) => player.username === username);
}

async function findTournament(id) {
  const response = await fetch(`${API_ROOT}/tournaments/${id}/rounds`);
  return response.json();
}

async function getRounds() {
  const searchParams = new URLSearchParams(window.location.search);
  const [player, tournament] = await Promise.all([
    findPlayer(searchParams.get("player")),
    findTournament(
      Number.parseInt(searchParams.get("tournament"), 10) || 59567
    ),
  ]);

  if (!player) {
    return [];
  }

  return Promise.all(
    tournament.map(async (round) => {
      const opponents = round.matches
        .filter(
          ({ white, black }) => white === player.id || black === player.id
        )
        .map(({ white, black }) => (white === player.id ? black : white));

      const players = await Promise.all(
        [player.id, ...opponents].map((id) =>
          fetch(`${API_ROOT}/players/${id}`).then((response) => response.json())
        )
      );

      const games = await Promise.all(
        round.matches
          .filter(({ white }) => players.some(({ id }) => id === white))
          .map(({ gameid }) =>
            fetch(`${API_ROOT}/games/${gameid}`).then((response) =>
              response.json()
            )
          )
      );

      return {
        round: round.round_number,
        players: players.map((player) => ({
          player,
          games: games.filter(
            ({ players }) =>
              players.white.id === player.id || players.black.id === player.id
          ),
        })),
      };
    })
  );
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
          childData: (player) => ({
            username: player.player.username,
            playerHref: `https://online-go.com/player/${player.player.id}`,
            games: {
              items: player.games,
              childData: (game) => {
                const isBlack = game.players.black.id === player.player.id;
                const opponent = isBlack
                  ? game.players.white
                  : game.players.black;

                return {
                  color: isBlack ? "Black" : "White",
                  gameHref: `https://online-go.com/game/${game.id}`,
                  opponent: opponent.username,
                  opponentHref: `https://online-go.com/player/${opponent.id}`,
                  result: getResult(game.gamedata),
                };
              },
            },
          }),
        },
      }),
    },
  });

  document.body.appendChild(fragment);
}

document.addEventListener("DOMContentLoaded", main);
