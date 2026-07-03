// Mobile Menu Selector & Logic
const menu = document.querySelector('#mobile-menu');
const menuLinks = document.querySelector('.navbar__menu');

if (menu) {
    menu.addEventListener('click', function(e) {
        e.preventDefault();
        menu.classList.toggle('is-active');
        menuLinks.classList.toggle('active');
    });
}

// Multi-step Booking Form Wizard Engine
document.addEventListener('DOMContentLoaded', () => {
    const steps = document.querySelectorAll('.form-step');
    const stepIndicators = document.querySelectorAll('.step');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const submitBtn = document.querySelector('.submit-booking-btn');
    const bookingForm = document.querySelector('.booking-form');
    
    let currentStep = 0;

    // Conditional elements
    const typeSelfDrive = document.getElementById('type-self-drive');
    const typeWithDriver = document.getElementById('type-with-driver');
    const driverOptions = document.getElementById('options-with-driver');
    const driverSelect = document.getElementById('driver-service');

    // Conditional Fields based on Choice
    const selfDriveFields = document.querySelectorAll('.self-drive-only');
    const withDriverFields = document.querySelectorAll('.with-driver-only');

    function updateFormSteps() {
        // Show/Hide steps layout
        steps.forEach((step, index) => {
            if (index === currentStep) {
                step.classList.add('form-step--active');
                step.style.display = 'flex'; // Siguradong litaw sa mobile flex layout
            } else {
                step.classList.remove('form-step--active');
                step.style.display = 'none';
            }
        });

        // Update step indicator classes
        stepIndicators.forEach((indicator, index) => {
            if (index <= currentStep) {
                indicator.classList.add('step--active');
            } else {
                indicator.classList.remove('step--active');
            }
        });

        // Navigation button conditional renders
        if (currentStep === 0) {
            if (prevBtn) {
                prevBtn.disabled = true;
                prevBtn.style.display = 'none';
            }
        } else {
            if (prevBtn) {
                prevBtn.disabled = false;
                prevBtn.style.display = 'block';
            }
        }

        if (currentStep === steps.length - 1) {
            if (nextBtn) nextBtn.style.display = 'none';
            if (submitBtn) submitBtn.style.display = 'block';
        } else {
            if (nextBtn) nextBtn.style.display = 'block';
            if (submitBtn) submitBtn.style.display = 'none';
        }
        
        // Auto-scroll pabalik sa taas ng form para sa mobile view kapag nag-next
        const bookingSection = document.querySelector('.booking-section');
        if (bookingSection) {
            bookingSection.scrollIntoView({ behavior: 'smooth' });
        }
    }

    // Input validations engine per step
    function validateStepInputs() {
        const activeStepFields = steps[currentStep].querySelectorAll('input[required], select[required], textarea[required]');
        let isValid = true;

        activeStepFields.forEach(field => {
            // Check if element is part of hidden parent logic
            const isSelfDriveHidden = field.closest('.self-drive-only') && typeWithDriver && typeWithDriver.checked;
            const isWithDriverHidden = field.closest('.with-driver-only') && typeSelfDrive && typeSelfDrive.checked;
            const isServiceSelectHidden = field.id === 'driver-service' && typeSelfDrive && typeSelfDrive.checked;

            if (isSelfDriveHidden || isWithDriverHidden || isServiceSelectHidden) {
                return; // Skip hidden logic fields
            }

            if (field.type === 'radio') {
                const checkedRadio = steps[currentStep].querySelector(`input[name="${field.name}"]:checked`);
                if (!checkedRadio) {
                    isValid = false;
                }
            } else if (!field.value.trim()) {
                isValid = false;
                field.style.borderColor = '#ef4444'; // Pula kapag kulang
            } else {
                field.style.borderColor = '#cbd5e1';
            }
        });

        return isValid;
    }

    function attachFieldRecoveryListeners() {
        const formFields = bookingForm.querySelectorAll('input[required], select[required], textarea[required]');

        formFields.forEach(field => {
            field.addEventListener('input', () => {
                if (field.value.trim()) {
                    field.style.borderColor = '#cbd5e1';
                }
            });

            field.addEventListener('change', () => {
                if (field.value.trim()) {
                    field.style.borderColor = '#cbd5e1';
                }
            });
        });
    }

    function setSubmitLoading(isLoading) {
        if (!submitBtn) return;
        submitBtn.disabled = isLoading;
        submitBtn.textContent = isLoading ? 'Sending...' : 'Submit Booking Request';
    }

    // Step 2 Radio logic updates
    function handleRentalTypeChange() {
        if (!typeWithDriver || !typeSelfDrive) return;

        if (typeWithDriver.checked) {
            if (driverOptions) driverOptions.style.display = 'block';
            if (driverSelect) driverSelect.setAttribute('required', 'required');
            
            selfDriveFields.forEach(el => el.style.display = 'none');
            withDriverFields.forEach(el => el.style.display = 'flex');
            
            const returnDate = document.getElementById('return_date');
            const returnTime = document.getElementById('return_time');
            const returnAddress = document.getElementById('return_address');
            const passengers = document.getElementById('passengers');
            const nameLabel = document.getElementById('name-label');

            if (returnDate) returnDate.removeAttribute('required');
            if (returnTime) returnTime.removeAttribute('required');
            if (returnAddress) returnAddress.removeAttribute('required');
            if (passengers) passengers.setAttribute('required', 'required');
            if (nameLabel) nameLabel.innerText = "Name *";
        } else if (typeSelfDrive.checked) {
            if (driverOptions) driverOptions.style.display = 'none';
            if (driverSelect) driverSelect.removeAttribute('required');

            selfDriveFields.forEach(el => el.style.display = 'flex');
            withDriverFields.forEach(el => el.style.display = 'none');

            const returnDate = document.getElementById('return_date');
            const returnTime = document.getElementById('return_time');
            const returnAddress = document.getElementById('return_address');
            const passengers = document.getElementById('passengers');
            const nameLabel = document.getElementById('name-label');

            if (returnDate) returnDate.setAttribute('required', 'required');
            if (returnTime) returnTime.setAttribute('required', 'required');
            if (returnAddress) returnAddress.setAttribute('required', 'required');
            if (passengers) passengers.removeAttribute('required');
            if (nameLabel) nameLabel.innerText = "Name / Driver's Name *";
        }
    }

    if (typeSelfDrive && typeWithDriver) {
        typeSelfDrive.addEventListener('change', handleRentalTypeChange);
        typeWithDriver.addEventListener('change', handleRentalTypeChange);
    }

    // Dynamic min attributes for date inputs: prevent selecting past dates
    const pickupDateInput = document.getElementsByName('pickup_date')[0];
    const returnDateInput = document.getElementById('return_date');

    if (pickupDateInput) {
        const ngayon = new Date();
        const taon = ngayon.getFullYear();
        const buwan = String(ngayon.getMonth() + 1).padStart(2, '0');
        const araw = String(ngayon.getDate()).padStart(2, '0');
        const formatNaPetsa = `${taon}-${buwan}-${araw}`;

        // Set pickup min to today
        pickupDateInput.min = formatNaPetsa;

        // If there's already a pickup value, ensure return min follows it
        if (returnDateInput && pickupDateInput.value) {
            returnDateInput.min = pickupDateInput.value;
        }

        // When pickup changes, update return.min and clear invalid return date
        pickupDateInput.addEventListener('change', function() {
            if (returnDateInput) {
                returnDateInput.min = this.value;
                if (returnDateInput.value && returnDateInput.value < this.value) {
                    returnDateInput.value = '';
                }
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (validateStepInputs()) {
                if (currentStep < steps.length - 1) {
                    currentStep++;
                    updateFormSteps();
                }
            } else {
                alert('Mangyaring punan ang lahat ng kinakailangang field (*) bago magpatuloy.');
            }
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentStep > 0) {
                currentStep--;
                updateFormSteps();
            }
        });
    }

    // ==========================================
    // PINAGSAMANG SUBMIT AT BACKEND CONNECTION LOGIC
    // ==========================================
    if (bookingForm) {
        attachFieldRecoveryListeners();

        bookingForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            if (!validateStepInputs()) {
                alert('Pakikumpleto ang mga kulang na impormasyon.');
                return;
            }

            // Client-side date validations: pickup must be >= today; return (for self-drive) must be >= pickup
            const pickupField = document.getElementsByName('pickup_date')[0];
            const returnField = document.getElementById('return_date');
            const selectedRentalTypeRadio = document.querySelector('input[name="rental_type"]:checked');
            const rentalTypeValue = selectedRentalTypeRadio ? selectedRentalTypeRadio.value : '';

            if (pickupField) {
                const pickupVal = pickupField.value;
                const today = new Date();
                today.setHours(0,0,0,0);
                const pickupDateObj = pickupVal ? new Date(pickupVal) : null;

                if (!pickupVal || !pickupDateObj || isNaN(pickupDateObj.getTime())) {
                    alert('Pakilagay ang tamang Pick-up date.');
                    pickupField.style.borderColor = '#ef4444';
                    return;
                }
                pickupDateObj.setHours(0,0,0,0);
                if (pickupDateObj < today) {
                    alert('Pick-up date must be today or a future date.');
                    pickupField.style.borderColor = '#ef4444';
                    return;
                }

                if (rentalTypeValue === 'self-drive' && returnField) {
                    const returnVal = returnField.value;
                    const returnDateObj = returnVal ? new Date(returnVal) : null;
                    if (!returnVal || !returnDateObj || isNaN(returnDateObj.getTime())) {
                        alert('Para sa Self-Drive, pakilagay ang tamang Return date.');
                        returnField.style.borderColor = '#ef4444';
                        return;
                    }
                    returnDateObj.setHours(0,0,0,0);
                    if (returnDateObj < pickupDateObj) {
                        alert('Return date cannot be earlier than Pick-up date.');
                        returnField.style.borderColor = '#ef4444';
                        return;
                    }
                }
            }

            // Execute reCAPTCHA v3 before submitting
            let recaptchaToken = '';
            try {
                const RECAPTCHA_SITE_KEY = 'YOUR_RECAPTCHA_SITE_KEY';
                if (typeof grecaptcha !== 'undefined' && RECAPTCHA_SITE_KEY && RECAPTCHA_SITE_KEY !== 'YOUR_RECAPTCHA_SITE_KEY') {
                    recaptchaToken = await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: 'submit_booking' });
                    document.getElementById('recaptchaToken').value = recaptchaToken;
                } else {
                    if (DEBUG) console.log('reCAPTCHA skipped (no valid site key or grecaptcha not loaded)');
                }
            } catch (err) {
                console.warn('reCAPTCHA execution failed:', err);
            }

            const formData = new FormData(this);
            const bookingData = Object.fromEntries(formData.entries());
            const selectedRentalType = bookingData.rental_type || '';

            bookingData.rentalType = selectedRentalType;

            if (selectedRentalType === 'with-driver') {
                bookingData.serviceOption = bookingData.driver_service || '';
            } else {
                bookingData.serviceOption = '—';
            }

            // Normalize vehicle field name to backend expected `vehicleType` (frontend uses `vehicle_type`)
            if (!bookingData.vehicleType) {
                if (bookingData.vehicle_type) bookingData.vehicleType = bookingData.vehicle_type;
                else if (bookingData.vehicle) bookingData.vehicleType = bookingData.vehicle;
            }

            try {
                setSubmitLoading(true);

                // Ipadala ang payload data sa Express Backend Endpoint mo
                const response = await fetch('http://localhost:3000/api/bookings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(bookingData)
                });

                const result = await response.json();

                if (response.ok && result.success) {
                    alert(`Thank you! Your booking request ${result.booking.ref} has been submitted.`);
                    this.reset();
                    window.location.reload(); // I-refresh ang layout para bumalik sa Step 1
                } else {
                    alert('May error sa server: ' + (result.error || 'Hindi mai-save ang data.'));
                }
            } catch (error) {
                console.error('Error submitting to backend:', error);
                alert('Hindi makakonekta sa server. Siguraduhing umaandar ang iyong `node server.js` sa Port 3000.');
            } finally {
                setSubmitLoading(false);
            }
        });
    }

    // Initialize layout setup state
    updateFormSteps();
});

// ==========================================
// FLEET VEHICLE FILTER ENGINE (SEDAN, MPV, EV)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab-btn');
    const cards = document.querySelectorAll('.fleet-card');

    if (tabs.length > 0 && cards.length > 0) {
        tabs.forEach(tab => {
            tab.addEventListener('click', function (e) {
                e.preventDefault();

                tabs.forEach(t => t.classList.remove('active'));
                this.classList.add('active');

                const filterValue = this.getAttribute('data-filter');

                cards.forEach(card => {
                    const category = card.getAttribute('data-category');

                    if (filterValue === 'all' || category === filterValue) {
                        card.style.display = 'flex'; 
                    } else {
                        card.style.display = 'none'; 
                    }
                });
            });
        });
    }
});

// --- NAV HIGHLIGHT (active link) ---
document.addEventListener('DOMContentLoaded', () => {
    const navLinks = document.querySelectorAll('.navbar__links');
    const current = window.location.pathname.split('/').pop() || 'index.html';
    navLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        if (href === current || (href === 'index.html' && current === '')) {
            link.classList.add('active');
        }
        // Also support anchors (e.g., #partner)
        if (href.startsWith('#') && window.location.hash === href) {
            link.classList.add('active');
        }

        // Close mobile menu after clicking a link
        link.addEventListener('click', () => {
            const mobileToggle = document.getElementById('mobile-menu');
            const menu = document.querySelector('.navbar__menu');
            if (mobileToggle && mobileToggle.classList.contains('is-active')) {
                mobileToggle.classList.remove('is-active');
            }
            if (menu && menu.classList.contains('active')) {
                menu.classList.remove('active');
            }
        });

        // Smooth scroll for anchors
        if (href.startsWith('#')) {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
    });
});