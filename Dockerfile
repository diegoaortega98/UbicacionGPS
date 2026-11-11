FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY GpsSystem.Api/GpsSystem.Api.csproj GpsSystem.Api/
RUN dotnet restore GpsSystem.Api/GpsSystem.Api.csproj
COPY GpsSystem.Api/ GpsSystem.Api/
RUN dotnet publish GpsSystem.Api/GpsSystem.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:10000
EXPOSE 10000
ENTRYPOINT ["dotnet", "GpsSystem.Api.dll"]
