using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using GpsSystem.Api.Models;
using Microsoft.IdentityModel.Tokens;

namespace GpsSystem.Api.Services;

public sealed class TokenService(IConfiguration configuration) : ITokenService
{
    private readonly byte[] _secret = Encoding.UTF8.GetBytes(
        configuration["JWT_SECRET"]
        ?? throw new InvalidOperationException("La variable de entorno JWT_SECRET es obligatoria."));

    public string CrearToken(Usuario usuario)
    {
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, usuario.Id),
            new Claim(JwtRegisteredClaimNames.Email, usuario.Email ?? string.Empty),
            new Claim(ClaimTypes.NameIdentifier, usuario.Id),
            new Claim(ClaimTypes.Name, usuario.Email ?? usuario.UserName ?? usuario.Id),
            new Claim(ClaimTypes.Role, usuario.Rol)
        };
        var credentials = new SigningCredentials(new SymmetricSecurityKey(_secret), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: configuration["JWT_ISSUER"],
            audience: configuration["JWT_AUDIENCE"],
            claims: claims,
            expires: DateTime.UtcNow.AddHours(24),
            signingCredentials: credentials);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string ProtegerPin(string pin) =>
        Convert.ToHexString(HMACSHA256.HashData(_secret, Encoding.UTF8.GetBytes(pin)));

    public bool VerificarPin(string pin, string hash)
    {
        var supplied = Convert.FromHexString(ProtegerPin(pin));
        var expected = Convert.FromHexString(hash);
        return CryptographicOperations.FixedTimeEquals(supplied, expected);
    }
}
