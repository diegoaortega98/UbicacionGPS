using GpsSystem.Api.Models;

namespace GpsSystem.Api.Services;

public interface ITokenService
{
    string CrearToken(Usuario usuario);

    string ProtegerPin(string pin);

    bool VerificarPin(string pin, string hash);
}
