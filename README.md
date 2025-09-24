# MyPlatform Project

This project is an example integration of the **Adyen Embedded Payment && Embedded Financial Product**, with a **frontend built in Angular** and a **backend using Spring Boot**.

## Table of Contents

- [Requirements](#requirements)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Running the Application](#running-the-application)
- [Notes](#notes)

---

## Requirements

- **Node.js**: v18+ (for Angular 17)
- **npm**: v9+ (or yarn)
- **Java**: 21
- **Maven**: 3.8+
- Modern browser (Chrome, Firefox, Edge)
- Recommended IDE: IntelliJ IDEA or VS Code

---

## Project Structure
- `/frontend` -> Angular frontend application
- `/backend` -> Spring Boot backend application

### Frontend
- Angular 17
- Uses Adyen Web SDK and Angular Material

### Backend
- Spring Boot 3
- Dependencies:
    - Spring Web
    - Spring Data JPA
    - SQLite (local database)
    - Adyen Java API library
    - Hibernate
    - Lombok

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/quentinl-ady/myplatform-demo.git
cd myplatform-demo
```

### 2. Install the frontend

```bash
cd frontend
npm install
```
### 3. Install the backend

```bash
cd ../backend
mvn clean install
```
#### or with maven wrapper 

```bash
cd ../backend
./mvnw clean install
```

## Environment Variables
To run the project, you need to provide Adyen API credentials. You can do this in `backend/src/main/resources/application.properties`

## Running the Application

### 1. Start the backend
From the `/backend` directory:
```bash
mvn spring-boot:run
```

#### or with maven wrapper
```bash
./mvnw spring-boot:run
```

The backend will run on http://localhost:8080

### 2. Start the frontend
From the `/frontend` directory:
```bash
npm start
```
The frontend will run on http://localhost:4200

## Database
- SQLite is used as a local database.
- Database file is stored in the backend project folder.
