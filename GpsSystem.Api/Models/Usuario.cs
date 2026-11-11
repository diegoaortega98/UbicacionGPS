using Microsoft.AspNetCore.Identity;

namespace GpsSystem.Api.Models;

public class Usuario : IdentityUser
{
    public string Rol { get; set; } = RolesUsuario.Pasajero;

    public string Telefono { get; set; } = string.Empty;

    public PerfilConductor? PerfilConductor { get; set; }
}

public static class RolesUsuario
{
    public const string Pasajero = "Pasajero";
    public const string Conductor = "Conductor";
}
