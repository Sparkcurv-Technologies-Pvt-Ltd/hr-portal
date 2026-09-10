"""
Backend API Tests for HR Portal MySQL Migration
Tests 3-tier role system: Admin, Manager, Employee
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://attendance-hub-1369.preview.emergentagent.com')

# Test credentials
ADMIN_EMAIL = "admin@hrportal.com"
ADMIN_PASSWORD = "Admin@123"
MANAGER_EMAIL = "manager@company.com"
MANAGER_PASSWORD = "Manager@123"
EMPLOYEE_EMAIL = "emp@company.com"
EMPLOYEE_PASSWORD = "Emp@123"


class TestAuthLogin:
    """Test authentication for all 3 roles"""
    
    def test_admin_login(self):
        """Admin login should succeed and return admin role"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        data = response.json()
        assert data["role"] == "admin", f"Expected admin role, got {data['role']}"
        assert data["email"] == ADMIN_EMAIL
        print(f"✓ Admin login successful: {data['name']} ({data['role']})")
    
    def test_manager_login(self):
        """Manager login should succeed and return manager role"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": MANAGER_EMAIL,
            "password": MANAGER_PASSWORD
        })
        assert response.status_code == 200, f"Manager login failed: {response.text}"
        data = response.json()
        assert data["role"] == "manager", f"Expected manager role, got {data['role']}"
        assert data["email"] == MANAGER_EMAIL
        print(f"✓ Manager login successful: {data['name']} ({data['role']})")
    
    def test_employee_login(self):
        """Employee login should succeed and return employee role"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": EMPLOYEE_EMAIL,
            "password": EMPLOYEE_PASSWORD
        })
        assert response.status_code == 200, f"Employee login failed: {response.text}"
        data = response.json()
        assert data["role"] == "employee", f"Expected employee role, got {data['role']}"
        assert data["email"] == EMPLOYEE_EMAIL
        print(f"✓ Employee login successful: {data['name']} ({data['role']})")
    
    def test_invalid_login(self):
        """Invalid credentials should return 401"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "invalid@test.com",
            "password": "wrongpassword"
        })
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("✓ Invalid login correctly rejected")


class TestHolidaysAPI:
    """Test holidays endpoints"""
    
    def test_holidays_list_returns_12_holidays(self):
        """GET /api/holidays/list should return 12 holidays"""
        response = requests.get(f"{BASE_URL}/api/holidays/list")
        assert response.status_code == 200
        holidays = response.json()
        assert len(holidays) == 12, f"Expected 12 holidays, got {len(holidays)}"
        print(f"✓ Holidays list returns {len(holidays)} holidays")
        
        # Verify first and last holiday
        assert holidays[0]["festival"] == "New Year"
        assert holidays[-1]["festival"] == "Christmas"
        print("✓ Holiday list contains New Year and Christmas")


class TestLeaveBalance:
    """Test leave balance endpoint"""
    
    def test_leave_balance_values(self):
        """Leave balance should show casual:12, sick:3, loss_of_pay:0"""
        session = requests.Session()
        # Login as employee
        login_resp = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": EMPLOYEE_EMAIL,
            "password": EMPLOYEE_PASSWORD
        })
        assert login_resp.status_code == 200
        
        # Get leave balance
        response = session.get(f"{BASE_URL}/api/leave/balance")
        assert response.status_code == 200
        balance = response.json()
        
        assert balance["casual"] == 12, f"Expected casual=12, got {balance['casual']}"
        assert balance["sick"] == 3, f"Expected sick=3, got {balance['sick']}"
        assert balance["loss_of_pay"] == 0, f"Expected loss_of_pay=0, got {balance['loss_of_pay']}"
        print(f"✓ Leave balance correct: casual={balance['casual']}, sick={balance['sick']}, lop={balance['loss_of_pay']}")


class TestAdminEmployeeManagement:
    """Test admin employee CRUD operations"""
    
    @pytest.fixture
    def admin_session(self):
        """Get authenticated admin session"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, "Admin login failed"
        return session
    
    def test_admin_can_list_employees(self, admin_session):
        """Admin should be able to list all employees"""
        response = admin_session.get(f"{BASE_URL}/api/admin/employees")
        assert response.status_code == 200
        employees = response.json()
        assert len(employees) >= 3, f"Expected at least 3 employees, got {len(employees)}"
        
        # Verify roles exist
        roles = [e["role"] for e in employees]
        assert "admin" in roles, "Admin role not found in employees"
        assert "manager" in roles, "Manager role not found in employees"
        assert "employee" in roles, "Employee role not found in employees"
        print(f"✓ Admin can list {len(employees)} employees with all 3 roles")
    
    def test_admin_create_employee_with_role(self, admin_session):
        """Admin should be able to create employee with role selector"""
        import time
        test_email = f"test.role.{int(time.time())}@company.com"
        
        # Create employee with manager role
        response = admin_session.post(f"{BASE_URL}/api/admin/employees", json={
            "email": test_email,
            "password": "Test@123",
            "name": "Test Role User",
            "department": "Testing",
            "position": "Tester",
            "role": "manager"
        })
        assert response.status_code == 200, f"Create employee failed: {response.text}"
        data = response.json()
        assert data["role"] == "manager", f"Expected manager role, got {data['role']}"
        print(f"✓ Admin created employee with manager role: {test_email}")
        
        # Cleanup - delete the test user
        admin_session.delete(f"{BASE_URL}/api/admin/employees/{data['id']}")
    
    def test_admin_edit_employee_role(self, admin_session):
        """Admin should be able to edit employee role"""
        import time
        test_email = f"test.edit.{int(time.time())}@company.com"
        
        # Create employee first
        create_resp = admin_session.post(f"{BASE_URL}/api/admin/employees", json={
            "email": test_email,
            "password": "Test@123",
            "name": "Test Edit User",
            "department": "Testing",
            "position": "Tester",
            "role": "employee"
        })
        assert create_resp.status_code == 200
        emp_id = create_resp.json()["id"]
        
        # Update role to manager
        update_resp = admin_session.put(f"{BASE_URL}/api/admin/employees/{emp_id}", json={
            "role": "manager"
        })
        assert update_resp.status_code == 200
        updated = update_resp.json()
        assert updated["role"] == "manager", f"Expected manager role after update, got {updated['role']}"
        print(f"✓ Admin updated employee role from employee to manager")
        
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/admin/employees/{emp_id}")
    
    def test_admin_reset_password(self, admin_session):
        """Admin should be able to reset employee password"""
        import time
        test_email = f"test.reset.{int(time.time())}@company.com"
        
        # Create employee first
        create_resp = admin_session.post(f"{BASE_URL}/api/admin/employees", json={
            "email": test_email,
            "password": "OldPass@123",
            "name": "Test Reset User",
            "department": "Testing",
            "position": "Tester",
            "role": "employee"
        })
        assert create_resp.status_code == 200
        emp_id = create_resp.json()["id"]
        
        # Reset password
        reset_resp = admin_session.post(f"{BASE_URL}/api/admin/employees/{emp_id}/reset-password", json={
            "new_password": "NewPass@123"
        })
        assert reset_resp.status_code == 200, f"Password reset failed: {reset_resp.text}"
        print(f"✓ Admin reset password for employee")
        
        # Verify new password works
        new_session = requests.Session()
        login_resp = new_session.post(f"{BASE_URL}/api/auth/login", json={
            "email": test_email,
            "password": "NewPass@123"
        })
        assert login_resp.status_code == 200, "Login with new password failed"
        print(f"✓ Employee can login with new password")
        
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/admin/employees/{emp_id}")


class TestManagerPermissions:
    """Test manager role permissions"""
    
    @pytest.fixture
    def manager_session(self):
        """Get authenticated manager session"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": MANAGER_EMAIL,
            "password": MANAGER_PASSWORD
        })
        assert response.status_code == 200, "Manager login failed"
        return session
    
    def test_manager_can_view_leave_requests(self, manager_session):
        """Manager should be able to view leave requests"""
        response = manager_session.get(f"{BASE_URL}/api/admin/leave-requests")
        assert response.status_code == 200, f"Manager cannot view leave requests: {response.text}"
        print("✓ Manager can view leave requests")
    
    def test_manager_can_view_permissions(self, manager_session):
        """Manager should be able to view permission requests"""
        response = manager_session.get(f"{BASE_URL}/api/admin/permissions")
        assert response.status_code == 200, f"Manager cannot view permissions: {response.text}"
        print("✓ Manager can view permission requests")
    
    def test_manager_can_view_attendance(self, manager_session):
        """Manager should be able to view attendance"""
        response = manager_session.get(f"{BASE_URL}/api/admin/attendance")
        assert response.status_code == 200, f"Manager cannot view attendance: {response.text}"
        print("✓ Manager can view attendance")
    
    def test_manager_can_view_analytics(self, manager_session):
        """Manager should be able to view analytics"""
        response = manager_session.get(f"{BASE_URL}/api/admin/analytics")
        assert response.status_code == 200, f"Manager cannot view analytics: {response.text}"
        print("✓ Manager can view analytics")
    
    def test_manager_cannot_create_employees(self, manager_session):
        """Manager should NOT be able to create employees"""
        response = manager_session.post(f"{BASE_URL}/api/admin/employees", json={
            "email": "test.manager.create@company.com",
            "password": "Test@123",
            "name": "Test User",
            "department": "Testing",
            "position": "Tester",
            "role": "employee"
        })
        assert response.status_code == 403, f"Manager should not create employees, got {response.status_code}"
        print("✓ Manager correctly blocked from creating employees")
    
    def test_manager_cannot_view_payslips(self, manager_session):
        """Manager should NOT be able to view all payslips (admin only)"""
        response = manager_session.get(f"{BASE_URL}/api/admin/payslips")
        assert response.status_code == 403, f"Manager should not view payslips, got {response.status_code}"
        print("✓ Manager correctly blocked from viewing payslips")


class TestEmployeePermissions:
    """Test employee role permissions"""
    
    @pytest.fixture
    def employee_session(self):
        """Get authenticated employee session"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": EMPLOYEE_EMAIL,
            "password": EMPLOYEE_PASSWORD
        })
        assert response.status_code == 200, "Employee login failed"
        return session
    
    def test_employee_cannot_access_admin_endpoints(self, employee_session):
        """Employee should NOT be able to access admin endpoints"""
        # Try to access admin employees list
        response = employee_session.get(f"{BASE_URL}/api/admin/employees")
        assert response.status_code == 403, f"Employee should not access admin endpoints, got {response.status_code}"
        print("✓ Employee correctly blocked from admin endpoints")
    
    def test_employee_can_access_own_data(self, employee_session):
        """Employee should be able to access their own data"""
        # Leave balance
        balance_resp = employee_session.get(f"{BASE_URL}/api/leave/balance")
        assert balance_resp.status_code == 200
        
        # Attendance status
        status_resp = employee_session.get(f"{BASE_URL}/api/attendance/status")
        assert status_resp.status_code == 200
        
        # Permission balance
        perm_resp = employee_session.get(f"{BASE_URL}/api/permission/balance")
        assert perm_resp.status_code == 200
        
        print("✓ Employee can access own data (leave balance, attendance, permissions)")


class TestRoleBadges:
    """Test that role badges are correctly returned in employee list"""
    
    def test_employee_list_has_role_field(self):
        """Employee list should include role field for badge display"""
        session = requests.Session()
        session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        
        response = session.get(f"{BASE_URL}/api/admin/employees")
        assert response.status_code == 200
        employees = response.json()
        
        for emp in employees:
            assert "role" in emp, f"Employee {emp.get('email')} missing role field"
            assert emp["role"] in ["admin", "manager", "employee"], f"Invalid role: {emp['role']}"
        
        # Count roles
        role_counts = {}
        for emp in employees:
            role_counts[emp["role"]] = role_counts.get(emp["role"], 0) + 1
        
        print(f"✓ All employees have valid roles: {role_counts}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
