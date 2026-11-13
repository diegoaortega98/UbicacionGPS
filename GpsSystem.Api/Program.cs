using GpsSystem.Api;
using GpsSystem.Api.Data;
using GpsSystem.Api.Hubs;
using GpsSystem.Api.Middleware;
using GpsSystem.Api.Models;
using GpsSystem.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
var firebaseVapidKey = Environment.GetEnvironmentVariable("FIREBASE_VAPID_KEY");
if (!string.IsNullOrWhiteSpace(firebaseVapidKey)
    && string.IsNullOrWhiteSpace(builder.Configuration["Firebase:Web:VapidKey"]))
{
    builder.Configuration["Firebase:Web:VapidKey"] = firebaseVapidKey;
}

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.AddSecurityDefinition("Bearer", new Microsoft.OpenApi.Models.OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Description = "Ingresa el token JWT devuelto por /api/auth/login."
    });
    options.AddSecurityRequirement(new Microsoft.OpenApi.Models.OpenApiSecurityRequirement
    {
        {
            new Microsoft.OpenApi.Models.OpenApiSecurityScheme
            {
                Reference = new Microsoft.OpenApi.Models.OpenApiReference
                {
                    Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});
builder.Services.AddExceptionHandler<ApiExceptionHandler>();
builder.Services.AddProblemDetails();
builder.Services.AddSignalR();
builder.Services.AddCors(options =>
{
    options.AddPolicy("GpsClient", policy =>
        policy.WithOrigins("http://localhost:5023", "https://ubicaciongps.onrender.com")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials());
});

var jwtSecret = builder.Configuration["JWT_SECRET"];
if (string.IsNullOrWhiteSpace(jwtSecret) || Encoding.UTF8.GetByteCount(jwtSecret) < 32)
{
    throw new InvalidOperationException("Configura JWT_SECRET con al menos 32 bytes aleatorios.");
}

var databaseUrl = Environment.GetEnvironmentVariable("DATABASE_URL");
if (string.IsNullOrWhiteSpace(databaseUrl))
{
    databaseUrl = builder.Configuration.GetConnectionString("DefaultConnection");
}

if (string.IsNullOrWhiteSpace(databaseUrl))
{
    throw new InvalidOperationException("Configura DATABASE_URL o ConnectionStrings:DefaultConnection.");
}

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(DatabaseUrl.ToConnectionString(databaseUrl)));
builder.Services.AddIdentityCore<Usuario>(options =>
    {
        options.User.RequireUniqueEmail = true;
        options.Password.RequiredLength = 10;
        options.Password.RequireDigit = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireNonAlphanumeric = true;
    })
    .AddRoles<IdentityRole>()
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();
builder.Services.AddScoped<ITokenService, TokenService>();
builder.Services.AddScoped<IViajeService, ViajeService>();
builder.Services.AddSingleton<FirebaseMessagingProvider>();
builder.Services.AddScoped<NotificacionService>();
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ValidateIssuer = !string.IsNullOrWhiteSpace(builder.Configuration["JWT_ISSUER"]),
            ValidIssuer = builder.Configuration["JWT_ISSUER"],
            ValidateAudience = !string.IsNullOrWhiteSpace(builder.Configuration["JWT_AUDIENCE"]),
            ValidAudience = builder.Configuration["JWT_AUDIENCE"],
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
            NameClaimType = System.Security.Claims.ClaimTypes.Name,
            RoleClaimType = System.Security.Claims.ClaimTypes.Role
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                {
                    context.Token = accessToken;
                }

                return Task.CompletedTask;
            },
            OnAuthenticationFailed = context =>
            {
                if (builder.Environment.IsDevelopment())
                {
                    var reason = context.Exception switch
                    {
                        SecurityTokenExpiredException expired => $"token expiró en {expired.Expires:O}",
                        SecurityTokenInvalidSignatureException => "firma inválida",
                        SecurityTokenInvalidIssuerException => "emisor inválido",
                        SecurityTokenInvalidAudienceException => "audiencia inválida",
                        _ => context.Exception.GetType().Name
                    };
                    Console.WriteLine($"Falló la autenticación JWT: {reason}");
                }

                return Task.CompletedTask;
            },
            OnChallenge = context =>
            {
                if (builder.Environment.IsDevelopment() && !string.IsNullOrEmpty(context.ErrorDescription))
                {
                    Console.WriteLine($"Desafío JWT: {context.ErrorDescription}");
                }

                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthorization();

var app = builder.Build();

_ = app.Services.GetRequiredService<FirebaseMessagingProvider>();

app.UseExceptionHandler();
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRouting();
app.UseCors("GpsClient");
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<GpsHub>("/gpsHub");
app.MapHub<ViajeHub>("/hubs/viaje").RequireAuthorization();
app.MapHub<ViajeHub>("/hubs/viajes").RequireAuthorization();
app.MapHub<ChatHub>("/hubs/chat").RequireAuthorization();
app.MapHub<LlamadaHub>("/hubs/llamada").RequireAuthorization();
app.MapFallbackToFile("index.html");

if (!app.Environment.IsEnvironment("Testing"))
{
    await using var scope = app.Services.CreateAsyncScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await dbContext.Database.MigrateAsync();
    var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
    foreach (var role in new[] { RolesUsuario.Pasajero, RolesUsuario.Conductor })
    {
        if (!await roleManager.RoleExistsAsync(role))
        {
            var result = await roleManager.CreateAsync(new IdentityRole(role));
            if (!result.Succeeded)
            {
                throw new InvalidOperationException($"No se pudo inicializar el rol {role}: {string.Join(", ", result.Errors.Select(error => error.Description))}");
            }
        }
    }
}

app.Run();

public partial class Program { }
