require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");

const passport = require("passport");
const FacebookStrategy =
    require("passport-facebook").Strategy;


const conexion = require("./conexion");

const app = express();

const PORT = process.env.PORT || 3000;

// Servidor HTTP

const servidor = http.createServer(app);

// Socket.io

const io = new Server(servidor);

// Middleware

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));

app.use(session({
    secret: "clave-juego-serpientes",
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());

app.use(express.static(
    path.join(__dirname, "public")
));


// API Facebook

passport.use(
    new FacebookStrategy(
        {
            clientID: process.env.FACEBOOK_APP_ID,
            clientSecret: process.env.FACEBOOK_APP_SECRET,
            callbackURL: "http://localhost:3000/auth/facebook/callback",
            profileFields: ["id", "displayName", "email"]
        },

        function (accessToken, refreshToken, profile, done) {
            const facebookId = profile.id;

            const correoMeta =
                profile.emails && profile.emails.length > 0
                    ? profile.emails[0].value
                    : null;

            // Buscar si esta cuenta de Facebook ya existe.
            const sqlBuscar = `
                SELECT id, usuario, correo
                FROM usuarios
                WHERE proveedor = ? AND proveedor_id = ?
                LIMIT 1
            `;

            conexion.query(
                sqlBuscar,
                ["facebook", facebookId],
                (error, resultados) => {
                    if (error) {
                        return done(error);
                    }

                    // Si ya existe, reutilizar la cuenta.
                    if (resultados.length > 0) {
                        return done(null, resultados[0]);
                    }

                    // Crear una cuenta nueva.
                    const crearUsuario = (correoFinal) => {
                        const nombreUsuario =
                            `fb_${facebookId}`.slice(0, 50);

                        const sqlInsertar = `
                            INSERT INTO usuarios
                                (usuario, correo, password,
                                 proveedor, proveedor_id)
                            VALUES (?, ?, NULL, ?, ?)
                        `;

                        conexion.query(
                            sqlInsertar,
                            [
                                nombreUsuario,
                                correoFinal,
                                "facebook",
                                facebookId
                            ],
                            (error, resultado) => {
                                if (error) {
                                    return done(error);
                                }

                                conexion.query(
                                    `SELECT id, usuario, correo
                                     FROM usuarios
                                     WHERE id = ?`,
                                    [resultado.insertId],
                                    (error, nuevosUsuarios) => {
                                        if (error) {
                                            return done(error);
                                        }

                                        if (nuevosUsuarios.length === 0) {
                                            return done(
                                                new Error(
                                                    "No se encontró el usuario creado."
                                                )
                                            );
                                        }

                                        return done(
                                            null,
                                            nuevosUsuarios[0]
                                        );
                                    }
                                );
                            }
                        );
                    };

                    // Facebook puede no proporcionar correo.
                    if (!correoMeta) {
                        return crearUsuario(null);
                    }

                    // Evitar duplicar un correo ya registrado.
                    conexion.query(
                        `SELECT id FROM usuarios
                         WHERE correo = ? LIMIT 1`,
                        [correoMeta],
                        (error, usuariosCorreo) => {
                            if (error) {
                                return done(error);
                            }

                            const correoFinal =
                                usuariosCorreo.length > 0
                                    ? null
                                    : correoMeta;

                            crearUsuario(correoFinal);
                        }
                    );
                }
            );
        }
    )
);


// Sesion mediante Facebook

app.get(
    "/auth/facebook",
    passport.authenticate("facebook", {
        scope: ["email"],
        session: false
    })
);

app.get(
    "/auth/facebook/callback",

    passport.authenticate("facebook", {
        session: false,
        failureRedirect: "/?facebook=error"
    }),

    (req, res) => {
        const usuario = req.user;

        // Utilizar la misma estructura de sesión
        req.session.usuario = {
            id: usuario.id,
            usuario: usuario.usuario,
            correo: usuario.correo
        };

        // Guardar la sesión antes de ir al lobby.
        req.session.save((error) => {
            if (error) {
                console.error(
                    "Error al guardar sesión de Facebook:",
                    error
                );

                return res
                    .status(500)
                    .send("No se pudo crear la sesión.");
            }

            return res.redirect("/lobby.html");
        });
    }
);

// Registro Usuarios

app.post("/registro", (req, res) => {

    const {
        usuario,
        correo,
        password
    } = req.body;


    if (!usuario || !correo || !password) {

        return res.status(400).json({
            mensaje: "Todos los campos son obligatorios."
        });

    }


    const sql = `
        INSERT INTO usuarios
        (usuario, correo, password)
        VALUES (?, ?, ?)
    `;


    conexion.query(
        sql,
        [usuario, correo, password],
        (error, resultado) => {

            if (error) {

                console.error(
                    "Error al registrar usuario:",
                    error
                );


                if (error.code === "ER_DUP_ENTRY") {

                    return res.status(400).json({
                        mensaje:
                            "El usuario o correo ya existe."
                    });

                }


                return res.status(500).json({
                    mensaje:
                        "Error al registrar el usuario."
                });

            }


            return res.status(201).json({
                mensaje:
                    "Usuario registrado correctamente."
            });

        }
    );

});

// Inicio Sesion

app.post("/login", (req, res) => {

    const {
        usuario,
        password
    } = req.body;


    if (!usuario || !password) {

        return res.status(400).json({
            mensaje:
                "Usuario y contraseña son obligatorios."
        });

    }


    const sql = `
        SELECT id, usuario, correo
        FROM usuarios
        WHERE usuario = ?
        AND password = ?
    `;


    conexion.query(
        sql,
        [usuario, password],
        (error, resultados) => {

            if (error) {

                console.error(
                    "Error al iniciar sesión:",
                    error
                );

                return res.status(500).json({
                    mensaje:
                        "Error del servidor."
                });

            }


            if (resultados.length === 0) {

                return res.status(401).json({
                    mensaje:
                        "Usuario o contraseña incorrectos."
                });

            }


            const usuarioEncontrado =
                resultados[0];


            req.session.usuario = {

                id: usuarioEncontrado.id,

                usuario:
                    usuarioEncontrado.usuario,

                correo:
                    usuarioEncontrado.correo

            };


            return res.status(200).json({

                mensaje:
                    "Inicio de sesión correcto.",

                usuario:
                    usuarioEncontrado.usuario

            });

        }
    );

});

// Comprobar la sesion

app.get("/sesion", (req, res) => {


    if (!req.session.usuario) {

        return res.status(401).json({
            autenticado: false
        });

    }


    return res.status(200).json({

        autenticado: true,

        usuario: req.session.usuario

    });

});

// Cierra Sesion

app.post("/logout", (req, res) => {


    req.session.destroy((error) => {

        if (error) {

            console.error(
                "Error al cerrar sesión:",
                error
            );

            return res.status(500).json({
                mensaje:
                    "No se pudo cerrar la sesión."
            });

        }


        return res.status(200).json({
            mensaje:
                "Sesión cerrada correctamente."
        });

    });

});

// Mecanicas Serpientes y Escaleras etc

let jugadoresLobby = [];

let partidasActivas = {};

const escaleras = {
    7: 47,
    20: 59,
    28: 33,
    49: 88,
    51: 91,
    56: 96
};

const serpientes = {
    29: 9,
    42: 25,
    55: 15,
    77: 37,
    87: 48,
    97: 61
};


io.on("connection", (socket) => {

    console.log(
        "Jugador conectado mediante Socket.IO:",
        socket.id
    );

socket.on(
    "entrarPartida",
    ({ partidaId, usuarioId }) => {

        console.log(
            "Jugador entrando a partida:",
            partidaId,
            usuarioId
        );

        const partida =
            partidasActivas[partidaId];

        if (!partida) {

            console.log(
                "No existe la partida:",
                partidaId
            );

            socket.emit(
                "errorJuego",
                {
                    mensaje:
                        "La partida no existe."
                }
            );

            return;
        }

if (partida.finalizada) {

    socket.emit(
        "errorJuego",
        {
            mensaje:
                "La partida ya terminó."
        }
    );

    return;
}

        if (
            usuarioId !== partida.jugador1Id &&
            usuarioId !== partida.jugador2Id
        ) {

            socket.emit(
                "errorJuego",
                {
                    mensaje:
                        "No perteneces a esta partida."
                }
            );

            return;
        }

        if (
            usuarioId === partida.jugador1Id
        ) {

            partida.socketJugador1 =
                socket.id;

        } else {

            partida.socketJugador2 =
                socket.id;
        }


        console.log(
            "Estado actualizado:",
            partida
        );

        socket.emit(
            "estadoInicial",
            {
                partidaId: partidaId,

                jugador1Id:
                    partida.jugador1Id,

                jugador2Id:
                    partida.jugador2Id,

                posicionJugador1:
                    partida.posicionJugador1,

                posicionJugador2:
                    partida.posicionJugador2,

                turno:
                    partida.turno,

                resultadoDado:
                    partida.resultadoDado,

                miUsuarioId:
                    usuarioId
            }
        );

    }
);

    socket.on("disconnect", () => {

        console.log(
            "Jugador desconectado:",
            socket.id
        );


        // Eliminarlo del lobby

        jugadoresLobby =
            jugadoresLobby.filter(
                jugador => jugador.socketId !== socket.id
            );


        // Actualizar a los jugadores restantes

        io.emit(
            "actualizarLobby",
            jugadoresLobby
        );


        console.log(
            "Jugadores actualmente en el lobby:",
            jugadoresLobby.length
        );

    });

    socket.on("entrarLobby", (usuario) => {

        console.log(
            "Jugador entró al lobby:",
            usuario.usuario
        );


        // Evitar que el mismo socket se agregue
        // más de una vez

        const jugadorExistente =
            jugadoresLobby.find(
                jugador => jugador.socketId === socket.id
            );


        if (jugadorExistente) {
            return;
        }


        // Agregar jugador

        jugadoresLobby.push({

            socketId: socket.id,

            id: usuario.id,

            usuario: usuario.usuario,

            correo: usuario.correo

        });


        console.log(
            "Jugadores actualmente en el lobby:",
            jugadoresLobby.length
        );

        io.emit(
            "actualizarLobby",
            jugadoresLobby
        );

        if (jugadoresLobby.length === 2) {

    console.log(
        "¡Hay dos jugadores! La partida está lista."
    );

    const jugador1 = jugadoresLobby[0];
    const jugador2 = jugadoresLobby[1];

    const sql = `
        INSERT INTO partidas
        (jugador1_id, jugador2_id, estado, turno)
        VALUES (?, ?, ?, ?)
    `;

    conexion.query(
        sql,
        [
            jugador1.id,
            jugador2.id,
            "iniciada",
            jugador1.id
        ],
        (error, resultado) => {

            if (error) {

                console.error(
                    "Error al crear la partida:",
                    error
                );

                return;
            }

            const partidaId =
                resultado.insertId;

            console.log(
                "Partida creada correctamente. ID:",
                partidaId
            );

            partidasActivas[partidaId] = {
                jugador1Id: jugador1.id,
                jugador2Id: jugador2.id,
                posicionJugador1: 1,
                posicionJugador2: 1,
                turno: jugador1.id,
                resultadoDado: null,
                finalizada: false,
                ganador: null
            };

            io.emit(
                "partidaLista",
                {
                    partidaId: partidaId,
                    jugadores: jugadoresLobby
                }
            );

        }
    );
}
});

socket.on(
    "lanzarDado",
    ({ partidaId, usuarioId }) => {

        console.log(
            "Solicitud para lanzar dado:",
            partidaId,
            usuarioId
        );

        const partida =
            partidasActivas[partidaId];

        if (!partida) {

            console.log(
                "La partida no existe."
            );

            socket.emit(
                "errorJuego",
                {
                    mensaje:
                        "La partida no existe."
                }
            );

            return;
        }

        if (
            usuarioId !== partida.jugador1Id &&
            usuarioId !== partida.jugador2Id
        ) {

            console.log(
                "Usuario no pertenece a la partida."
            );

            socket.emit(
                "errorJuego",
                {
                    mensaje:
                        "No perteneces a esta partida."
                }
            );

            return;
        }

        if (usuarioId !== partida.turno) {

            console.log(
                "No es el turno de este jugador."
            );

            socket.emit(
                "errorJuego",
                {
                    mensaje:
                        "No es tu turno."
                }
            );

            return;
        }


        const resultado =
            Math.floor(Math.random() * 6) + 1;

        let posicionAnterior;
        let posicionNueva;


        if (
            usuarioId === partida.jugador1Id
        ) {

            posicionAnterior =
                partida.posicionJugador1;

            posicionNueva =
                posicionAnterior + resultado;

        } else {

            posicionAnterior =
                partida.posicionJugador2;

            posicionNueva =
                posicionAnterior + resultado;
        }

        if (posicionNueva > 100) {

            posicionNueva = 100;
        }

        if (
            escaleras[posicionNueva]
        ) {

            const destino =
                escaleras[posicionNueva];

            posicionNueva =
                destino;
        }

        else if (
            serpientes[posicionNueva]
        ) {

            const destino =
                serpientes[posicionNueva];

            posicionNueva =
                destino;
        }

        if (
            usuarioId === partida.jugador1Id
        ) {

            partida.posicionJugador1 =
                posicionNueva;

        } else {

            partida.posicionJugador2 =
                posicionNueva;
        }


let ganador = null;

if (posicionNueva === 100) {

    ganador = usuarioId;

    partida.finalizada = true;
    partida.ganador = usuarioId;

    // ==========================================
    // GUARDAR RESULTADO EN MYSQL
    // ==========================================

    const sqlFinalizarPartida = `
        UPDATE partidas
        SET
            estado = ?,
            ganador_id = ?,
            fecha_fin = CURRENT_TIMESTAMP
        WHERE id = ?
    `;

    conexion.query(
        sqlFinalizarPartida,
        [
            "finalizada",
            usuarioId,
            partidaId
        ],
        (error) => {

            if (error) {

                console.error(
                    "Error al guardar el resultado de la partida:",
                    error
                );

                return;
            }

            console.log(
                "Partida finalizada correctamente en MySQL."
            );
        }
    );
}

partida.resultadoDado =
    resultado;

if (!partida.finalizada) {

    if (
        usuarioId === partida.jugador1Id
    ) {

        partida.turno =
            partida.jugador2Id;

    } else {

        partida.turno =
            partida.jugador1Id;
    }
}

        io.emit(
            "estadoPartida",
            {
                partidaId: partidaId,

                jugador1Id:
                    partida.jugador1Id,

                jugador2Id:
                    partida.jugador2Id,

                posicionJugador1:
                    partida.posicionJugador1,

                posicionJugador2:
                    partida.posicionJugador2,

                turno:
                    partida.turno,

                resultadoDado:
                    partida.resultadoDado,
                finalizada:
    partida.finalizada,

ganador:
    partida.ganador
            }
        );

    }
);

socket.on(
    "errorJuego",
    function (datos) {

        console.error(
            "Error del juego:",
            datos.mensaje
        );

        document
            .getElementById("mensaje")
            .textContent =
            " " + datos.mensaje;

        moviendoJugador = false;

        actualizarBotonDado();
    }
);
});

servidor.listen(PORT, () => {

    console.log("=================================");
    console.log("Servidor del juego iniciado");
    console.log(`http://localhost:${PORT}`);
    console.log("Socket.IO activo");
    console.log("=================================");

});
