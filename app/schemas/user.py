from pydantic import BaseModel, EmailStr


class UserBase(BaseModel):
    full_name: str
    email: EmailStr

class UserCreate(UserBase):
    password: str

class UserRead(BaseModel):
    id: int
    full_name: str

    class Config:
        from_attributes = True