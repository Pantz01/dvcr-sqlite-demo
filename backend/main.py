import os, shutil
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import (
    Column, Integer, String, DateTime, ForeignKey, Boolean, Float, create_engine, Text, or_
)
from sqlalchemy.orm import sessionmaker, declarative_base, relationship, Session
import json  # ⬅️ NEW

# ----------------- Config / Env -----------------
DB_URL = os.getenv("DVCR_DB", "sqlite:///./dvcr.db")
UPLOAD_DIR = os.getenv("DVCR_UPLOAD_DIR", "uploads")
JWT_SECRET = os.getenv("DVCR_JWT_SECRET", "dev-secret-change-me")
JWT_EXPIRE_MINUTES = int(os.getenv("DVCR_JWT_EXPIRE_MINUTES", "43200"))  # 30 days
PM_OIL_SOON_MILES = int(os.getenv("DVCR_PM_OIL_SOON_MILES", "5000"))
PM_CHASSIS_SOON_MILES = int(os.getenv("DVCR_PM_CHASSIS_SOON_MILES", "3000"))

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://resourceful-compassion-production.up.railway.app",
    # add more frontend URLs as needed (e.g. your Railway frontend)
]
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ----------------- App -----------------
app = FastAPI(title="DVCR API")

# alias purely for log searches (optional)
app.add_mmiddleware = app.add_middleware  # type: ignore[attr-defined]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.up\.railway\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# ----------------- DB -----------------
engine = create_engine(
    DB_URL,
    connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ----------------- Models -----------------
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    role = Column(String, nullable=False)  # driver | mechanic | manager | admin
    password_hash = Column(String, nullable=True)

class PMAlert(BaseModel):
    truck_id: int
    truck_number: str
    odometer: int
    oil_next_due: int
    oil_miles_remaining: int
    chassis_next_due: int
    chassis_miles_remaining: int
    oil_due_soon: bool
    chassis_due_soon: bool
    class Config:
        from_attributes = True

class Truck(Base):
    __tablename__ = "trucks"
    id = Column(Integer, primary_key=True)
    number = Column(String, unique=True, index=True, nullable=False)
    vin = Column(String, nullable=True)
    active = Column(Boolean, default=True)
    odometer = Column(Integer, default=0)
    # cascades ensure deleting a truck removes child rows
    reports = relationship("Report", back_populates="truck", cascade="all, delete-orphan")
    services = relationship("ServiceRecord", back_populates="truck", cascade="all, delete-orphan")

class Report(Base):
    __tablename__ = "reports"
    id = Column(Integer, primary_key=True)
    truck_id = Column(Integer, ForeignKey("trucks.id"), nullable=False)
    driver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    odometer = Column(Integer, nullable=True)
    status = Column(String, default="OPEN")
    summary = Column(Text, nullable=True)
    type = Column(String, default="pre")  # 'pre' | 'post'
    truck = relationship("Truck", back_populates="reports")
    driver = relationship("User")
    defects = relationship("Defect", back_populates="report", cascade="all, delete-orphan")
    notes = relationship("Note", back_populates="report", cascade="all, delete-orphan")

class Defect(Base):
    __tablename__ = "defects"
    id = Column(Integer, primary_key=True)
    report_id = Column(Integer, ForeignKey("reports.id"), nullable=False)
    component = Column(String, nullable=False)
    severity = Column(String, default="minor")
    description = Column(Text, nullable=True)
    x = Column(Float, nullable=True)
    y = Column(Float, nullable=True)
    resolved = Column(Boolean, default=False)
    resolved_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    report = relationship("Report", back_populates="defects")
    photos = relationship("Photo", back_populates="defect", cascade="all, delete-orphan")
    resolved_by = relationship("User")

class Photo(Base):
    __tablename__ = "photos"
    id = Column(Integer, primary_key=True)
    defect_id = Column(Integer, ForeignKey("defects.id"), nullable=False)
    path = Column(String, unique=True, nullable=False)
    caption = Column(String, nullable=True)
    defect = relationship("Defect", back_populates="photos")

class Note(Base):
    __tablename__ = "notes"
    id = Column(Integer, primary_key=True)
    report_id = Column(Integer, ForeignKey("reports.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    report = relationship("Report", back_populates="notes")
    author = relationship("User")

class ServiceRecord(Base):
    __tablename__ = "service_records"
    id = Column(Integer, primary_key=True)
    truck_id = Column(Integer, ForeignKey("trucks.id"), nullable=False)
    service_type = Column(String, nullable=False)  # 'oil' | 'chassis'
    odometer = Column(Integer, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    truck = relationship("Truck", back_populates="services")

# ----------------- NEW: Role model -----------------
class Role(Base):
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)
    permissions_json = Column(Text, nullable=False, default="[]")

    @property
    def permissions(self) -> List[str]:
        try:
            return json.loads(self.permissions_json or "[]")
        except Exception:
            return []

    @permissions.setter
    def permissions(self, value: Optional[List[str]]):
        self.permissions_json = json.dumps(value or [])

# ----------------- NEW: PM Appointment model -----------------
class PMAppointment(Base):
    __tablename__ = "pm_appointments"
    id = Column(Integer, primary_key=True)
    truck_id = Column(Integer, ForeignKey("trucks.id"), nullable=False)
    service_type = Column(String, nullable=False)  # 'oil' | 'chassis'
    shop = Column(String, nullable=False)
    scheduled_date = Column(DateTime, nullable=False)
    status = Column(String, default="scheduled")   # 'scheduled' | 'completed' | 'cancelled'
    created_at = Column(DateTime, default=datetime.utcnow)
    truck = relationship("Truck")

Base.metadata.create_all(bind=engine)

# ----------------- Auth helpers -----------------
import jwt
from passlib.hash import bcrypt

def make_token(user_id: int) -> str:
    exp = datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MINUTES)
    # FIXED: removed stray closing bracket
    return jwt.encode({"sub": str(user_id), "exp": exp}, JWT_SECRET, algorithm="HS256")

def decode_token(token: str) -> int:
    data = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    return int(data["sub"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def require_user(request: Request, db: Session = Depends(get_db)) -> User:
    # Prefer JWT
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
        try:
            uid = decode_token(token)
            user = db.get(User, uid)
            if user:
                return user
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")

    # Back-compat demo header (kept for old frontend calls)
    user_id = request.headers.get("x-user-id")
    if user_id:
        user = db.get(User, int(user_id))
        if user:
            return user

    raise HTTPException(status_code=401, detail="Unauthorized")

def require_role(user: 'User', roles: List[str]):
    if user.role not in roles:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

# ----------------- Seed demo users/trucks -----------------
with SessionLocal() as db:
    if db.query(User).count() == 0:
        db.add_all([
            User(name="Alice Driver", email="driver@example.com", role="driver",
                 password_hash=bcrypt.hash("password123")),
            User(name="Manny Manager", email="manager@example.com", role="manager",
                 password_hash=bcrypt.hash("password123")),
            User(name="Mec McWrench", email="mechanic@example.com", role="mechanic",
                 password_hash=bcrypt.hash("password123")),
        ])
        if db.query(Truck).count() == 0:
            db.add_all([
                Truck(number="78014", vin="VIN78014", odometer=18000),
                Truck(number="78988", vin="VIN78988", odometer=9500),
            ])
        db.commit()

# ----------------- Schemas -----------------
class UserOut(BaseModel):
    id: int
    name: str
    email: str
    role: str
    class Config:
        from_attributes = True  # pydantic v2

class TruckIn(BaseModel):
    number: str
    vin: Optional[str] = None
    active: bool = True

class TruckOut(TruckIn):
    id: int
    odometer: int
    class Config:
        from_attributes = True

class PhotoOut(BaseModel):
    id: int
    path: str
    caption: Optional[str]
    class Config:
        from_attributes = True

class DefectIn(BaseModel):
    component: str
    severity: str = Field(default="minor")
    description: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None

class DefectOut(DefectIn):
    id: int
    resolved: bool
    resolved_by_id: Optional[int] = None
    resolved_at: Optional[datetime] = None
    photos: List[PhotoOut] = []
    class Config:
        from_attributes = True

class NoteIn(BaseModel):
    text: str

class NoteOut(BaseModel):
    id: int
    author: UserOut
    text: str
    created_at: datetime
    class Config:
        from_attributes = True

class ReportIn(BaseModel):
    odometer: Optional[int] = None
    summary: Optional[str] = None
    type: str = "pre"  # 'pre' | 'post'

class ReportOut(BaseModel):
    id: int
    truck: TruckOut
    driver: UserOut
    created_at: datetime
    odometer: Optional[int]
    status: str
    summary: Optional[str]
    type: str
    defects: List[DefectOut] = []
    notes: List[NoteOut] = []
    class Config:
        from_attributes = True

class LoginIn(BaseModel):
    email: str
    password: str

class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

class PMStatus(BaseModel):
    odometer: int
    oil_next_due: int
    oil_miles_remaining: int
    chassis_next_due: int
    chassis_miles_remaining: int

class ServiceIn(BaseModel):
    service_type: str  # 'oil' | 'chassis'
    odometer: int
    notes: Optional[str] = None

# ---- User admin schemas ----
class UserCreate(BaseModel):
    name: str
    email: str
    role: str  # 'driver' | 'mechanic' | 'manager' | 'admin'
    password: str

class UserPatch(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None

# ---- Truck admin / service schemas ----
class TruckPatch(BaseModel):
    number: Optional[str] = None
    vin: Optional[str] = None
    active: Optional[bool] = None
    odometer: Optional[int] = None

class ServiceOut(BaseModel):
    id: int
    truck_id: int
    service_type: str
    odometer: int
    notes: Optional[str] = None
    created_at: datetime
    class Config:
        from_attributes = True

# ----------------- NEW: Role schemas -----------------
class RoleCreate(BaseModel):
    name: str = Field(..., max_length=100)
    permissions: List[str] = Field(default_factory=list)

class RoleOut(BaseModel):
    id: int
    name: str
    permissions: List[str]
    class Config:
        from_attributes = True

class RoleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    permissions: Optional[List[str]] = None

# ----------------- NEW: PM Appointment schemas -----------------
class PMAppointmentIn(BaseModel):
    truck_id: int
    service_type: str  # 'oil' | 'chassis'
    shop: str
    scheduled_date: datetime

class PMAppointmentPatch(BaseModel):
    shop: Optional[str] = None
    scheduled_date: Optional[datetime] = None
    status: Optional[str] = None  # 'scheduled' | 'completed' | 'cancelled'

class PMAppointmentOut(BaseModel):
    id: int
    truck_id: int
    service_type: str
    shop: str
    scheduled_date: datetime
    status: str
    created_at: datetime
    class Config:
        from_attributes = True

# ----------------- Routes -----------------
@app.post("/auth/login", response_model=LoginOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not user.password_hash or not bcrypt.verify(payload.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    token = make_token(user.id)
    return {"access_token": token, "user": user}

@app.get("/me", response_model=UserOut)
async def me(user: User = Depends(require_user)):
    return user

# ----------------- NEW: Roles CRUD -----------------
@app.get("/roles", response_model=List[RoleOut])
def list_roles(user: User = Depends(require_user), db: Session = Depends(get_db)):
    require_role(user, ["manager", "admin"])  # allow managers too
    roles = db.query(Role).order_by(Role.name.asc()).all()
    return [RoleOut(id=r.id, name=r.name, permissions=r.permissions) for r in roles]

@app.post("/roles", response_model=RoleOut, status_code=201)
def create_role(payload: RoleCreate, user: User = Depends(require_user), db: Session = Depends(get_db)):
    require_role(user, ["admin"])
    if db.query(Role).filter(Role.name == payload.name).first():
        raise HTTPException(status_code=400, detail="Role name already exists")
    r = Role(name=payload.name)
    r.permissions = payload.permissions
    db.add(r)
    db.commit()
    db.refresh(r)
    return RoleOut(id=r.id, name=r.name, permissions=r.permissions)

@app.patch("/roles/{role_id}", response_model=RoleOut)
def update_role(role_id: int, payload: RoleUpdate, user: User = Depends(require_user), db: Session = Depends(get_db)):
    require_role(user, ["admin"])
    r = db.query(Role).filter(Role.id == role_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")
    if payload.name is not None:
        exists = db.query(Role).filter(Role.name == payload.name, Role.id != role_id).first()
        if exists:
            raise HTTPException(status_code=400, detail="Role name already exists")
        r.name = payload.name
    if payload.permissions is not None:
        r.permissions = payload.permissions
    db.commit()
    db.refresh(r)
    return RoleOut(id=r.id, name=r.name, permissions=r.permissions)

@app.delete("/roles/{role_id}", status_code=204)
def delete_role(role_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    require_role(user, ["admin"])
    r = db.query(Role).filter(Role.id == role_id).first()
    if not r:
        return Response(status_code=204)
    db.delete(r)
    db.commit()
    return Response(status_code=204)

@app.get("/alerts/pm", response_model=List[PMAlert])
def pm_alerts(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    # managers/admins only
    require_role(user, ["manager", "admin"])

    results: List[PMAlert] = []
    trucks = db.query(Truck).filter(Truck.active == True).all()

    for t in trucks:
        s = pm_status_for(t, db)
        oil_soon = s["oil_miles_remaining"] <= PM_OIL_SOON_MILES
        ch_soon = s["chassis_miles_remaining"] <= PM_CHASSIS_SOON_MILES
        if oil_soon or ch_soon:
            results.append(PMAlert(
                truck_id=t.id,
                truck_number=t.number,
                odometer=s["odometer"],
                oil_next_due=s["oil_next_due"],
                oil_miles_remaining=s["oil_miles_remaining"],
                chassis_next_due=s["chassis_next_due"],
                chassis_miles_remaining=s["chassis_miles_remaining"],
                oil_due_soon=oil_soon,
                chassis_due_soon=ch_soon,
            ))
    # sort by the most urgent (fewest miles remaining)
    results.sort(key=lambda r: min(
        r.oil_miles_remaining if r.oil_due_soon else 10**9,
        r.chassis_miles_remaining if r.chassis_due_soon else 10**9
    ))
    return results

# ----------------- NEW: Alerts with appointments (non-breaking; extra endpoint) -----------------
@app.get("/alerts/pm-with-appts")
def pm_alerts_with_appts(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_role(user, ["manager", "admin"])
    out = []
    trucks = db.query(Truck).filter(Truck.active == True).all()
    for t in trucks:
        s = pm_status_for(t, db)
        oil_soon = s["oil_miles_remaining"] <= PM_OIL_SOON_MILES
        ch_soon = s["chassis_miles_remaining"] <= PM_CHASSIS_SOON_MILES
        if not (oil_soon or ch_soon):
            continue

        appt_oil = db.query(PMAppointment).filter(
            PMAppointment.truck_id == t.id,
            PMAppointment.service_type == "oil",
            PMAppointment.status == "scheduled"
        ).order_by(PMAppointment.scheduled_date.asc()).first()

        appt_ch = db.query(PMAppointment).filter(
            PMAppointment.truck_id == t.id,
            PMAppointment.service_type == "chassis",
            PMAppointment.status == "scheduled"
        ).order_by(PMAppointment.scheduled_date.asc()).first()

        out.append({
            "truck_id": t.id,
            "truck_number": t.number,
            "odometer": s["odometer"],
            "oil_next_due": s["oil_next_due"],
            "oil_miles_remaining": s["oil_miles_remaining"],
            "chassis_next_due": s["chassis_next_due"],
            "chassis_miles_remaining": s["chassis_miles_remaining"],
            "oil_due_soon": oil_soon,
            "chassis_due_soon": ch_soon,
            "oil_appt": ({
                "id": appt_oil.id,
                "shop": appt_oil.shop,
                "scheduled_date": appt_oil.scheduled_date.isoformat(),
                "status": appt_oil.status,
            } if appt_oil else None),
            "chassis_appt": ({
                "id": appt_ch.id,
                "shop": appt_ch.shop,
                "scheduled_date": appt_ch.scheduled_date.isoformat(),
                "status": appt_ch.status,
            } if appt_ch else None),
        })
    return out

# ---- Users admin endpoints (search/pagination/sort + CRUD) ----
@app.get("/users", response_model=List[UserOut])
def users_list(
    response: Response,
    q: Optional[str] = None,
    skip: int = 0,
    limit: int = 25,
    sort: str = "name",
    order: str = "asc",
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_role(user, ["manager", "admin"])

    query = db.query(User)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(User.name.like(like), User.email.like(like), User.role.like(like)))

    total = query.count()

    col = getattr(User, sort, User.name)
    if order.lower() == "desc":
        col = col.desc()

    items = query.order_by(col).offset(skip).limit(limit).all()
    response.headers["X-Total-Count"] = str(total)
    return items

@app.post("/users", response_model=UserOut)
def users_create(payload: UserCreate, user: User = Depends(require_user), db: Session = Depends(get_db)):
    require_role(user, ["manager", "admin"])
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(400, "Email already exists")
    new_user = User(
        name=payload.name,
        email=payload.email,
        role=payload.role,
        password_hash=bcrypt.hash(payload.password),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.patch("/users/{uid}", response_model=UserOut)
def users_patch(uid: int, payload: UserPatch, user: User = Depends(require_user), db: Session = Depends(get_db)):
    require_role(user, ["manager", "admin"])
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "User not found")

    if payload.email and payload.email != u.email:
        if db.query(User).filter(User.email == payload.email).first():
            raise HTTPException(400, "Email already exists")
        u.email = payload.email

    if payload.name is not None:
        u.name = payload.name
    if payload.role is not None:
        u.role = payload.role
    if payload.password:
        u.password_hash = bcrypt.hash(payload.password)

    db.commit()
    db.refresh(u)
    return u

@app.delete("/users/{uid}", status_code=204)
def users_delete(uid: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    require_role(user, ["manager", "admin"])
    u = db.get(User, uid)
    if not u:
        return
    if u.id == user.id:
        raise HTTPException(400, "Refusing to delete your own account")
    db.delete(u)
    db.commit()

# ---- Trucks / Reports / Notes / Defects ----
@app.get("/trucks", response_model=List[TruckOut])
def list_trucks(db: Session = Depends(get_db)):
    return db.query(Truck).order_by(Truck.number).all()

@app.post("/trucks", response_model=TruckOut)
def create_truck(payload: TruckIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    require_role(user, ["manager", "admin"])
    t = Truck(number=payload.number, vin=payload.vin, active=payload.active)
    db.add(t); db.commit(); db.refresh(t); return t

@app.get("/trucks/{truck_id}", response_model=TruckOut)
def get_truck(truck_id: int, db: Session = Depends(get_db)):
    t = db.get(Truck, truck_id)
    if not t: raise HTTPException(404, "Truck not found")
    return t

# Update truck
@app.patch("/trucks/{truck_id}", response_model=TruckOut)
def patch_truck(
    truck_id: int,
    payload: TruckPatch,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_role(user, ["manager", "admin"])
    t = db.get(Truck, truck_id)
    if not t:
        raise HTTPException(404, "Truck not found")

    if payload.number is not None:
        exists = db.query(Truck).filter(Truck.number == payload.number, Truck.id != truck_id).first()
        if exists:
            raise HTTPException(400, "Truck number already exists")
        t.number = payload.number

    if payload.vin is not None:
        t.vin = payload.vin
    if payload.active is not None:
        t.active = payload.active
    if payload.odometer is not None:
        t.odometer = payload.odometer

    db.commit()
    db.refresh(t)
    return t

# Delete truck (cascades to reports/services/defects/notes/photos)
@app.delete("/trucks/{truck_id}", status_code=204)
def delete_truck(
    truck_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_role(user, ["manager", "admin"])
    t = db.get(Truck, truck_id)
    if not t:
        return
    db.delete(t)
    db.commit()

# >>> reports list supports filter + pagination and returns X-Total-Count
@app.get("/trucks/{truck_id}/reports", response_model=List[ReportOut])
def list_reports(
    truck_id: int,
    response: Response,
    type: Optional[str] = None,  # 'pre' | 'post' (optional)
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    q = db.query(Report).filter(Report.truck_id == truck_id).order_by(Report.created_at.desc())
    if type in ("pre", "post"):
        q = q.filter(Report.type == type)

    total = q.count()
    items = q.offset(skip).limit(limit).all()

    # eager-load nested collections
    for r in items:
        _ = r.defects, r.notes
        for d in r.defects:
            _ = d.photos

    response.headers["X-Total-Count"] = str(total)
    return items

@app.post("/trucks/{truck_id}/reports", response_model=ReportOut)
def create_report(truck_id: int, payload: ReportIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    truck = db.get(Truck, truck_id)
    if not truck: raise HTTPException(404, "Truck not found")
    r = Report(truck_id=truck_id, driver_id=user.id, odometer=payload.odometer, summary=payload.summary, type=payload.type)
    db.add(r)
    # update truck odometer if report has a higher reading
    if payload.odometer and (truck.odometer is None or payload.odometer > truck.odometer):
        truck.odometer = payload.odometer
    db.commit(); db.refresh(r); return r

@app.get("/reports/{report_id}", response_model=ReportOut)
def get_report(report_id: int, db: Session = Depends(get_db)):
    r = db.get(Report, report_id)
    if not r: raise HTTPException(404, "Report not found")
    # eager-load collections
    _ = r.defects, r.notes
    for d in r.defects: _ = d.photos
    return r

# ReportPatch supports 'type'
class ReportPatch(BaseModel):
    status: Optional[str] = None
    summary: Optional[str] = None
    odometer: Optional[int] = None
    type: Optional[str] = None  # 'pre' | 'post'

# patch_report can update 'type'
@app.patch("/reports/{report_id}", response_model=ReportOut)
def patch_report(
    report_id: int,
    payload: ReportPatch,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    r = db.get(Report, report_id)
    if not r: raise HTTPException(404, "Report not found")
    if payload.status is not None:
        require_role(user, ["manager", "mechanic", "admin"])
        r.status = payload.status
    if payload.summary is not None:
        r.summary = payload.summary
    if payload.odometer is not None:
        r.odometer = payload.odometer
    if payload.type is not None:
        if payload.type not in ("pre", "post"):
            raise HTTPException(400, "type must be 'pre' or 'post'")
        r.type = payload.type
    db.commit(); db.refresh(r); return r

@app.delete("/reports/{report_id}", status_code=204)
def delete_report(
    report_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_role(user, ["manager", "admin"])
    r = db.get(Report, report_id)
    if not r:
        return
    db.delete(r)
    db.commit()

@app.post("/reports/{report_id}/notes", response_model=NoteOut)
def add_note(report_id: int, note: NoteIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    r = db.get(Report, report_id)
    if not r: raise HTTPException(404, "Report not found")
    n = Note(report_id=report_id, author_id=user.id, text=note.text)
    db.add(n); db.commit(); db.refresh(n); return n

class DefectPatch(BaseModel):
    description: Optional[str] = None
    resolved: Optional[bool] = None

@app.post("/reports/{report_id}/defects", response_model=DefectOut)
def add_defect(report_id: int, d: DefectIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    r = db.get(Report, report_id)
    if not r: raise HTTPException(404, "Report not found")
    defect = Defect(report_id=report_id, component=d.component, severity=d.severity, description=d.description, x=d.x, y=d.y)
    db.add(defect); db.commit(); db.refresh(defect); return defect

@app.patch("/defects/{defect_id}", response_model=DefectOut)
def patch_defect(defect_id: int, payload: DefectPatch, user: User = Depends(require_user), db: Session = Depends(get_db)):
    d = db.get(Defect, defect_id)
    if not d: raise HTTPException(404, "Defect not found")
    if payload.description is not None: d.description = payload.description
    if payload.resolved is not None:
        require_role(user, ["mechanic", "manager", "admin"])
        d.resolved = payload.resolved
        d.resolved_by_id = user.id if payload.resolved else None
        d.resolved_at = datetime.utcnow() if payload.resolved else None
    db.commit(); db.refresh(d); return d

@app.post("/defects/{defect_id}/photos", response_model=List[PhotoOut])
async def upload_photos(defect_id: int, files: List[UploadFile] = File(...), captions: Optional[str] = Form(None), user: User = Depends(require_user), db: Session = Depends(get_db)):
    d = db.get(Defect, defect_id)
    if not d: raise HTTPException(404, "Defect not found")
    saved: List[Photo] = []
    for f in files:
        ts = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
        safe_name = f"{defect_id}_{ts}_{f.filename}"
        out_path = os.path.join(UPLOAD_DIR, safe_name)
        with open(out_path, "wb") as out: shutil.copyfileobj(f.file, out)
        p = Photo(defect_id=defect_id, path=f"/uploads/{safe_name}", caption=captions)
        db.add(p); saved.append(p)
    db.commit()
    for p in saved: db.refresh(p)
    return saved

# DELETE a defect (and its photos)
@app.delete("/defects/{defect_id}", status_code=204)
def delete_defect(
    defect_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    # mechanics, managers, admins may delete
    if user.role not in ["mechanic", "manager", "admin"]:
        raise HTTPException(403, "Insufficient permissions")
    d = db.get(Defect, defect_id)
    if not d:
        return

    # remove photo files from disk (best-effort)
    for p in d.photos:
        try:
            # paths are like "/uploads/filename.jpg"
            rel = p.path.lstrip("/")
            if not os.path.isabs(rel):
                rel = os.path.join(".", rel)
            if os.path.exists(rel):
                os.remove(rel)
        except Exception:
            pass

    db.delete(d)
    db.commit()

# DELETE a single photo
@app.delete("/photos/{photo_id}", status_code=204)
def delete_photo(
    photo_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if user.role not in ["mechanic", "manager", "admin"]:
        raise HTTPException(403, "Insufficient permissions")
    p = db.get(Photo, photo_id)
    if not p:
        return

    # best-effort remove file
    try:
        rel = p.path.lstrip("/")
        if not os.path.isabs(rel):
            rel = os.path.join(".", rel)
        if os.path.exists(rel):
            os.remove(rel)
    except Exception:
        pass

    db.delete(p)
    db.commit()

# ----------------- PM endpoints -----------------
def pm_status_for(truck: Truck, db: Session) -> dict:
    """
    Compute PM using STRICT interval-from-last-service logic:
      next_due = last_service_odometer + INTERVAL
    If there has never been a service and the truck's current odometer
    has already surpassed the first interval, round UP from the CURRENT
    ODO to the next interval multiple so the 'next due' is in the future.
    """
    odom = int(truck.odometer or 0)

    last_oil = db.query(ServiceRecord).filter_by(
        truck_id=truck.id, service_type="oil"
    ).order_by(ServiceRecord.odometer.desc()).first()
    last_ch = db.query(ServiceRecord).filter_by(
        truck_id=truck.id, service_type="chassis"
    ).order_by(ServiceRecord.odometer.desc()).first()

    last_oil_mi = int(last_oil.odometer) if last_oil else 0
    last_ch_mi = int(last_ch.odometer) if last_ch else 0

    OIL_INTERVAL = 20000
    CHASSIS_INTERVAL = 10000

    # Base = last service + interval
    oil_next = last_oil_mi + OIL_INTERVAL
    chassis_next = last_ch_mi + CHASSIS_INTERVAL

    # If no historical service and current odometer already beyond first interval,
    # anchor to the next future multiple of the interval based on CURRENT odometer
    if last_oil is None and odom > oil_next:
        oil_next = ((odom // OIL_INTERVAL) + 1) * OIL_INTERVAL
    if last_ch is None and odom > chassis_next:
        chassis_next = ((odom // CHASSIS_INTERVAL) + 1) * CHASSIS_INTERVAL

    return {
        "odometer": odom,
        "oil_next_due": oil_next,
        "oil_miles_remaining": max(oil_next - odom, 0),
        "chassis_next_due": chassis_next,
        "chassis_miles_remaining": max(chassis_next - odom, 0),
    }

@app.get("/trucks/{truck_id}/pm-next", response_model=PMStatus)
def pm_next(truck_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    truck = db.get(Truck, truck_id)
    if not truck: raise HTTPException(404, "Truck not found")
    return pm_status_for(truck, db)

@app.post("/trucks/{truck_id}/service", response_model=PMStatus)
def add_service(truck_id: int, svc: ServiceIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    if user.role not in ["manager", "mechanic", "admin"]:
        raise HTTPException(403, "Insufficient permissions")
    truck = db.get(Truck, truck_id)
    if not truck: raise HTTPException(404, "Truck not found")
    db.add(ServiceRecord(truck_id=truck_id, service_type=svc.service_type, odometer=svc.odometer, notes=svc.notes))
    if svc.odometer and (truck.odometer is None or svc.odometer > truck.odometer):
        truck.odometer = svc.odometer
    db.commit()

    # ----------------- NEW: mark earliest scheduled appt as completed for this service type -----------------
    appt = db.query(PMAppointment).filter(
        PMAppointment.truck_id == truck_id,
        PMAppointment.service_type == svc.service_type,
        PMAppointment.status == "scheduled"
    ).order_by(PMAppointment.scheduled_date.asc()).first()
    if appt:
        appt.status = "completed"
        db.commit()
    # ---------------------------------------------------------------------------------------

    return pm_status_for(truck, db)

@app.get("/trucks/{truck_id}/service", response_model=List[ServiceOut])
def list_service(truck_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    return db.query(ServiceRecord).filter_by(truck_id=truck_id).order_by(ServiceRecord.created_at.desc()).all()

@app.delete("/service/{service_id}", status_code=204)
def delete_service(service_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    if user.role not in ["manager", "mechanic", "admin"]:
        raise HTTPException(403, "Insufficient permissions")
    s = db.get(ServiceRecord, service_id)
    if not s:
        return
    db.delete(s)
    db.commit()

# ----------------- NEW: PM Appointment CRUD -----------------
@app.get("/pm/appointments", response_model=List[PMAppointmentOut])
def list_pm_appointments(
    truck_id: Optional[int] = None,
    status: Optional[str] = None,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_role(user, ["manager", "admin"])
    q = db.query(PMAppointment)
    if truck_id is not None:
        q = q.filter(PMAppointment.truck_id == truck_id)
    if status:
        q = q.filter(PMAppointment.status == status)
    return q.order_by(PMAppointment.scheduled_date.asc()).all()

@app.post("/pm/appointments", response_model=PMAppointmentOut)
def create_pm_appointment(
    payload: PMAppointmentIn,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_role(user, ["manager", "admin"])
    if payload.service_type not in ("oil", "chassis"):
        raise HTTPException(400, "service_type must be 'oil' or 'chassis'")
    appt = PMAppointment(
        truck_id=payload.truck_id,
        service_type=payload.service_type,
        shop=payload.shop,
        scheduled_date=payload.scheduled_date,
    )
    db.add(appt); db.commit(); db.refresh(appt)
    return appt

@app.patch("/pm/appointments/{appt_id}", response_model=PMAppointmentOut)
def patch_pm_appointment(
    appt_id: int,
    payload: PMAppointmentPatch,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_role(user, ["manager", "admin"])
    appt = db.get(PMAppointment, appt_id)
    if not appt:
        raise HTTPException(404, "Appointment not found")
    if payload.shop is not None:
        appt.shop = payload.shop
    if payload.scheduled_date is not None:
        appt.scheduled_date = payload.scheduled_date
    if payload.status is not None:
        if payload.status not in ("scheduled", "completed", "cancelled"):
            raise HTTPException(400, "Invalid status")
        appt.status = payload.status
    db.commit(); db.refresh(appt)
    return appt

@app.delete("/pm/appointments/{appt_id}", status_code=204)
def delete_pm_appointment(
    appt_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_role(user, ["manager", "admin"])
    appt = db.get(PMAppointment, appt_id)
    if not appt:
        return
    db.delete(appt); db.commit()

# ----------------- Health -----------------
@app.get("/health")
def health():
    return {"ok": True}
