const mysql = require("mysql2");

const conexion = mysql.createConnection({
host: "localhost",
user: "root",
password: "",
database: "gcw"
});

conexion.connect((error) => {

if (error) {
    console.error("Error al conectar con MySQL:", error);
    return;
}

console.log("Conectado correctamente a MySQL");

});

module.exports = conexion;
