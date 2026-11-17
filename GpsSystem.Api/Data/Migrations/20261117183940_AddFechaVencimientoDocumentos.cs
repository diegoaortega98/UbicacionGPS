using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GpsSystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFechaVencimientoDocumentos : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "FechaVencimientoDocumentos",
                table: "AspNetUsers",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FechaVencimientoDocumentos",
                table: "AspNetUsers");
        }
    }
}
